/**
 * FMEL Service - Cloud Run
 * Handles FMEL analytics and decision queries
 */

const express = require('express');
const { BigQuery } = require('@google-cloud/bigquery');
const { Firestore } = require('@google-cloud/firestore');

const app = express();
const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.PROJECT_ID;

if (!PROJECT_ID) {
    console.error('PROJECT_ID environment variable is required');
    process.exit(1);
}

// Initialize clients
const bigquery = new BigQuery();
const firestore = new Firestore();

// Middleware
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'fmel-service',
        version: '1.0.0'
    });
});

// Get FMEL decisions
app.get('/api/fmel/decisions', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const {
            agentId,
            limit = 100,
            startDate,
            endDate,
            actionType
        } = req.query;

        if (!agentId) {
            return res.status(400).json({ error: 'Agent ID is required' });
        }

        // Verify agent ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId && agentData.visibility !== 'public') {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Build BigQuery query
        let query = `
            SELECT
                decision_id,
                timestamp,
                agent_id,
                bar_number,
                action_type,
                symbol,
                quantity,
                price,
                confidence,
                reasoning,
                portfolio_value,
                cash_balance,
                total_pnl,
                market_context,
                indicators
            FROM \`${PROJECT_ID}.fmel.trading_decisions\`
            WHERE agent_id = @agentId
        `;

        const queryParams = { agentId };

        // Add date filters if provided
        if (startDate) {
            query += ` AND DATE(timestamp) >= @startDate`;
            queryParams.startDate = startDate;
        }

        if (endDate) {
            query += ` AND DATE(timestamp) <= @endDate`;
            queryParams.endDate = endDate;
        }

        // Add action type filter if provided
        if (actionType) {
            query += ` AND action_type = @actionType`;
            queryParams.actionType = actionType;
        }

        query += ` ORDER BY timestamp DESC LIMIT ${parseInt(limit)}`;

        // Execute query
        const options = {
            query,
            params: queryParams
        };

        const [rows] = await bigquery.query(options);

        res.json({
            decisions: rows,
            count: rows.length,
            agentId
        });

    } catch (error) {
        console.error('Error getting FMEL decisions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get FMEL analytics
app.get('/api/fmel/analytics', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const {
            agentId,
            dateRange = '30d'
        } = req.query;

        if (!agentId) {
            return res.status(400).json({ error: 'Agent ID is required' });
        }

        // Verify agent ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId && agentData.visibility !== 'public') {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Calculate date range
        const days = {
            '7d': 7,
            '30d': 30,
            '90d': 90,
            'all': 9999
        }[dateRange] || 30;

        // Analytics query
        const query = `
            WITH decision_stats AS (
                SELECT
                    COUNT(*) as total_decisions,
                    COUNTIF(action_type = 'BUY') as buy_decisions,
                    COUNTIF(action_type = 'SELL') as sell_decisions,
                    COUNTIF(action_type = 'HOLD') as hold_decisions,
                    AVG(confidence) as avg_confidence,
                    MIN(confidence) as min_confidence,
                    MAX(confidence) as max_confidence,
                    STDDEV(confidence) as confidence_stddev
                FROM \`${PROJECT_ID}.fmel.trading_decisions\`
                WHERE agent_id = @agentId
                    AND DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
            ),
            trade_performance AS (
                SELECT
                    COUNT(*) as total_trades,
                    COUNTIF(trade_pnl > 0) as winning_trades,
                    COUNTIF(trade_pnl <= 0) as losing_trades,
                    AVG(trade_pnl) as avg_trade_pnl,
                    MAX(trade_pnl) as best_trade,
                    MIN(trade_pnl) as worst_trade,
                    SUM(trade_pnl) as total_pnl
                FROM \`${PROJECT_ID}.fmel.trading_decisions\`
                WHERE agent_id = @agentId
                    AND DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
                    AND trade_pnl IS NOT NULL
            ),
            portfolio_metrics AS (
                SELECT
                    MAX(portfolio_value) as max_portfolio_value,
                    MIN(portfolio_value) as min_portfolio_value,
                    AVG(portfolio_value) as avg_portfolio_value,
                    MAX(portfolio_value) - MIN(portfolio_value) as portfolio_range,
                    LAST_VALUE(portfolio_value) OVER (ORDER BY timestamp) as current_value
                FROM \`${PROJECT_ID}.fmel.trading_decisions\`
                WHERE agent_id = @agentId
                    AND DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
                    AND portfolio_value IS NOT NULL
            ),
            daily_returns AS (
                SELECT
                    DATE(timestamp) as date,
                    LAST_VALUE(portfolio_value) OVER (
                        PARTITION BY DATE(timestamp)
                        ORDER BY timestamp
                        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
                    ) as closing_value
                FROM \`${PROJECT_ID}.fmel.trading_decisions\`
                WHERE agent_id = @agentId
                    AND DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
                    AND portfolio_value IS NOT NULL
            ),
            return_metrics AS (
                SELECT
                    AVG((closing_value - LAG(closing_value) OVER (ORDER BY date)) / LAG(closing_value) OVER (ORDER BY date)) as avg_daily_return,
                    STDDEV((closing_value - LAG(closing_value) OVER (ORDER BY date)) / LAG(closing_value) OVER (ORDER BY date)) as daily_return_stddev
                FROM daily_returns
            )
            SELECT
                decision_stats.*,
                trade_performance.* EXCEPT(total_trades),
                trade_performance.total_trades as completed_trades,
                portfolio_metrics.*,
                return_metrics.*,
                SAFE_DIVIDE(trade_performance.winning_trades, trade_performance.total_trades) as win_rate,
                SAFE_DIVIDE(return_metrics.avg_daily_return, NULLIF(return_metrics.daily_return_stddev, 0)) * SQRT(252) as sharpe_ratio
            FROM decision_stats
            CROSS JOIN trade_performance
            CROSS JOIN portfolio_metrics
            CROSS JOIN return_metrics
        `;

        const options = {
            query,
            params: {
                agentId,
                days: days
            }
        };

        const [rows] = await bigquery.query(options);

        // Get confidence distribution
        const confidenceQuery = `
            SELECT
                CASE
                    WHEN confidence < 0.2 THEN '0-20%'
                    WHEN confidence < 0.4 THEN '20-40%'
                    WHEN confidence < 0.6 THEN '40-60%'
                    WHEN confidence < 0.8 THEN '60-80%'
                    ELSE '80-100%'
                END as confidence_range,
                COUNT(*) as count
            FROM \`${PROJECT_ID}.fmel.trading_decisions\`
            WHERE agent_id = @agentId
                AND DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
            GROUP BY confidence_range
            ORDER BY confidence_range
        `;

        const [confidenceRows] = await bigquery.query({
            query: confidenceQuery,
            params: { agentId, days }
        });

        // Get action distribution over time
        const actionDistributionQuery = `
            SELECT
                DATE(timestamp) as date,
                action_type,
                COUNT(*) as count
            FROM \`${PROJECT_ID}.fmel.trading_decisions\`
            WHERE agent_id = @agentId
                AND DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
            GROUP BY date, action_type
            ORDER BY date DESC
            LIMIT 100
        `;

        const [actionRows] = await bigquery.query({
            query: actionDistributionQuery,
            params: { agentId, days }
        });

        res.json({
            agentId,
            dateRange,
            metrics: rows[0] || {},
            confidenceDistribution: confidenceRows,
            actionDistribution: actionRows,
            lastUpdated: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting FMEL analytics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get agent performance comparison
app.get('/api/fmel/compare', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { agentIds, metric = 'sharpe_ratio' } = req.query;

        if (!agentIds) {
            return res.status(400).json({ error: 'Agent IDs are required' });
        }

        const agentIdList = agentIds.split(',');

        // Verify ownership for all agents
        for (const agentId of agentIdList) {
            const agentDoc = await firestore.collection('agents').doc(agentId).get();
            if (!agentDoc.exists) {
                return res.status(404).json({ error: `Agent ${agentId} not found` });
            }

            const agentData = agentDoc.data();
            if (agentData.userId !== userId && agentData.visibility !== 'public') {
                return res.status(403).json({ error: `Access denied for agent ${agentId}` });
            }
        }

        // Comparison query
        const query = `
            WITH agent_performance AS (
                SELECT
                    agent_id,
                    COUNT(*) as total_decisions,
                    AVG(confidence) as avg_confidence,
                    SUM(CASE WHEN trade_pnl > 0 THEN 1 ELSE 0 END) / NULLIF(COUNT(trade_pnl), 0) as win_rate,
                    AVG(trade_pnl) as avg_trade_pnl,
                    SUM(trade_pnl) as total_pnl,
                    MAX(portfolio_value) as max_portfolio,
                    MIN(portfolio_value) as min_portfolio,
                    LAST_VALUE(portfolio_value) OVER (
                        PARTITION BY agent_id
                        ORDER BY timestamp
                        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
                    ) as current_portfolio
                FROM \`${PROJECT_ID}.fmel.trading_decisions\`
                WHERE agent_id IN UNNEST(@agentIds)
                    AND DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
                GROUP BY agent_id, portfolio_value, timestamp
            )
            SELECT
                agent_id,
                total_decisions,
                avg_confidence,
                win_rate,
                avg_trade_pnl,
                total_pnl,
                max_portfolio,
                min_portfolio,
                current_portfolio,
                SAFE_DIVIDE(current_portfolio - min_portfolio, min_portfolio) as total_return,
                SAFE_DIVIDE(avg_trade_pnl, STDDEV(trade_pnl) OVER (PARTITION BY agent_id)) * SQRT(252) as sharpe_ratio
            FROM agent_performance
            ORDER BY ${metric} DESC
        `;

        const options = {
            query,
            params: { agentIds: agentIdList }
        };

        const [rows] = await bigquery.query(options);

        res.json({
            comparison: rows,
            metric,
            agentCount: agentIdList.length
        });

    } catch (error) {
        console.error('Error comparing agents:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Search FMEL decisions
app.get('/api/fmel/search', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const {
            action,
            confidenceMin,
            confidenceMax,
            symbol,
            limit = 100
        } = req.query;

        // Build search query
        let query = `
            SELECT
                decision_id,
                timestamp,
                agent_id,
                action_type,
                symbol,
                confidence,
                reasoning,
                trade_pnl
            FROM \`${PROJECT_ID}.fmel.trading_decisions\`
            WHERE 1=1
        `;

        const queryParams = {};

        // Add filters
        if (action) {
            query += ` AND action_type = @action`;
            queryParams.action = action;
        }

        if (confidenceMin) {
            query += ` AND confidence >= @confidenceMin`;
            queryParams.confidenceMin = parseFloat(confidenceMin);
        }

        if (confidenceMax) {
            query += ` AND confidence <= @confidenceMax`;
            queryParams.confidenceMax = parseFloat(confidenceMax);
        }

        if (symbol) {
            query += ` AND symbol = @symbol`;
            queryParams.symbol = symbol;
        }

        // Only show user's agents or public agents
        query += ` AND agent_id IN (
            SELECT agent_id FROM \`${PROJECT_ID}.analytics.agents\`
            WHERE user_id = @userId OR visibility = 'public'
        )`;
        queryParams.userId = userId;

        query += ` ORDER BY timestamp DESC LIMIT ${parseInt(limit)}`;

        const options = {
            query,
            params: queryParams
        };

        const [rows] = await bigquery.query(options);

        res.json({
            results: rows,
            count: rows.length,
            filters: {
                action,
                confidenceMin,
                confidenceMax,
                symbol
            }
        });

    } catch (error) {
        console.error('Error searching FMEL:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export FMEL data
app.get('/api/fmel/export/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const userId = req.headers['x-user-id'];
        const { format = 'json', startDate, endDate } = req.query;

        // Verify agent ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Export query
        let query = `
            SELECT *
            FROM \`${PROJECT_ID}.fmel.trading_decisions\`
            WHERE agent_id = @agentId
        `;

        const queryParams = { agentId };

        if (startDate) {
            query += ` AND DATE(timestamp) >= @startDate`;
            queryParams.startDate = startDate;
        }

        if (endDate) {
            query += ` AND DATE(timestamp) <= @endDate`;
            queryParams.endDate = endDate;
        }

        query += ` ORDER BY timestamp`;

        const options = {
            query,
            params: queryParams
        };

        const [rows] = await bigquery.query(options);

        if (format === 'csv') {
            // Convert to CSV
            const headers = Object.keys(rows[0] || {}).join(',');
            const csvData = rows.map(row =>
                Object.values(row).map(val =>
                    typeof val === 'object' ? JSON.stringify(val) : val
                ).join(',')
            ).join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=fmel-${agentId}.csv`);
            res.send(`${headers}\n${csvData}`);
        } else {
            // Return as JSON
            res.json({
                agentId,
                exportDate: new Date().toISOString(),
                recordCount: rows.length,
                data: rows
            });
        }

    } catch (error) {
        console.error('Error exporting FMEL data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`FMEL service listening on port ${PORT}`);
});