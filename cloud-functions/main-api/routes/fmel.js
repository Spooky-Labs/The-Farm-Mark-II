/**
 * FMEL Analytics Routes
 * Consolidates fmel-analytics functionality
 */

const express = require('express');
const { BigQuery } = require('@google-cloud/bigquery');
const { Firestore } = require('@google-cloud/firestore');
const { rateLimiters } = require('../middleware/auth');

const router = express.Router();

// Initialize clients
const bigquery = new BigQuery();
const firestore = new Firestore();

const PROJECT_ID = process.env.PROJECT_ID;
const BQ_DATASET = 'fmel';

/**
 * Get trading decisions with filtering and pagination
 */
router.get('/decisions', rateLimiters.fmelQuery, async (req, res, next) => {
    try {
        const userId = req.user.uid;
        const {
            agentId,
            sessionId,
            mode,
            action,
            symbol,
            startDate,
            endDate,
            limit = 100,
            offset = 0,
            sortBy = 'timestamp',
            sortOrder = 'desc'
        } = req.query;

        // Build WHERE conditions
        const whereConditions = [`user_id = '${userId}'`];

        if (agentId) whereConditions.push(`agent_id = '${agentId}'`);
        if (sessionId) whereConditions.push(`run_id = '${sessionId}'`);
        if (mode) whereConditions.push(`mode = '${mode.toUpperCase()}'`);
        if (action) whereConditions.push(`JSON_EXTRACT_SCALAR(decision_data, '$.action') = '${action}'`);
        if (symbol) whereConditions.push(`JSON_EXTRACT_SCALAR(decision_data, '$.market_data.${symbol}') IS NOT NULL`);
        if (startDate) whereConditions.push(`timestamp >= '${startDate}'`);
        if (endDate) whereConditions.push(`timestamp <= '${endDate}'`);

        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

        // Validate sort parameters
        const validSortFields = ['timestamp', 'confidence', 'portfolio_value'];
        const validSortOrders = ['asc', 'desc'];

        const sortField = validSortFields.includes(sortBy) ? sortBy : 'timestamp';
        const sortDirection = validSortOrders.includes(sortOrder?.toLowerCase()) ? sortOrder.toUpperCase() : 'DESC';

        const query = `
        SELECT
          decision_id,
          timestamp,
          agent_id,
          run_id,
          mode,
          JSON_EXTRACT_SCALAR(decision_data, '$.action') as action,
          JSON_EXTRACT_SCALAR(decision_data, '$.reasoning') as reasoning,
          JSON_EXTRACT_SCALAR(decision_data, '$.confidence') as confidence,
          JSON_EXTRACT(decision_data, '$.market_data') as market_data,
          JSON_EXTRACT(decision_data, '$.indicators') as indicators,
          JSON_EXTRACT(decision_data, '$.portfolio') as portfolio,
          JSON_EXTRACT(decision_data, '$.position') as position,
          recorded_at
        FROM \`${PROJECT_ID}.${BQ_DATASET}.decision_analysis\`
        ${whereClause}
        ORDER BY ${sortField === 'timestamp' ? 'timestamp' :
                   sortField === 'confidence' ? 'SAFE_CAST(JSON_EXTRACT_SCALAR(decision_data, "$.confidence") AS FLOAT64)' :
                   'SAFE_CAST(JSON_EXTRACT_SCALAR(decision_data, "$.portfolio.value") AS FLOAT64)'} ${sortDirection}
        LIMIT ${parseInt(limit)}
        OFFSET ${parseInt(offset)}
        `;

        const [rows] = await bigquery.query(query);

        // Format response
        const decisions = rows.map(row => ({
            decisionId: row.decision_id,
            timestamp: row.timestamp,
            agentId: row.agent_id,
            sessionId: row.run_id,
            mode: row.mode,
            action: row.action,
            reasoning: row.reasoning,
            confidence: row.confidence ? parseFloat(row.confidence) : null,
            marketData: row.market_data,
            indicators: row.indicators,
            portfolio: row.portfolio,
            position: row.position,
            recordedAt: row.recorded_at
        }));

        res.json({
            decisions,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total: decisions.length
            },
            filters: {
                agentId,
                sessionId,
                mode,
                action,
                symbol,
                startDate,
                endDate
            }
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Get analytics dashboard data
 */
router.get('/analytics/:agentId', rateLimiters.fmelAnalytics, async (req, res, next) => {
    try {
        const { agentId } = req.params;
        const userId = req.user.uid;
        const { period = '30d', mode = 'all' } = req.query;

        // Verify agent ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Build WHERE conditions
        const whereConditions = [`agent_id = '${agentId}'`, `user_id = '${userId}'`];

        if (period !== 'all') {
            const daysBack = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
            whereConditions.push(`recorded_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${daysBack} DAY)`);
        }

        if (mode !== 'all') {
            whereConditions.push(`mode = '${mode.toUpperCase()}'`);
        }

        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

        // Analytics query
        const query = `
        WITH decision_metrics AS (
          SELECT
            DATE(timestamp) as date,
            mode,
            JSON_EXTRACT_SCALAR(decision_data, '$.action') as action,
            SAFE_CAST(JSON_EXTRACT_SCALAR(decision_data, '$.confidence') AS FLOAT64) as confidence,
            SAFE_CAST(JSON_EXTRACT_SCALAR(decision_data, '$.portfolio.value') AS FLOAT64) as portfolio_value,
            SAFE_CAST(JSON_EXTRACT_SCALAR(decision_data, '$.trade_pnl') AS FLOAT64) as trade_pnl,
            JSON_EXTRACT_SCALAR(decision_data, '$.reasoning') as reasoning,
            EXTRACT(HOUR FROM timestamp) as hour
          FROM \`${PROJECT_ID}.${BQ_DATASET}.decision_analysis\`
          ${whereClause}
        )
        SELECT
          -- Summary stats
          COUNT(*) as total_decisions,
          COUNT(CASE WHEN action IN ('buy', 'sell') THEN 1 END) as total_trades,
          COUNT(CASE WHEN action = 'buy' THEN 1 END) as buy_actions,
          COUNT(CASE WHEN action = 'sell' THEN 1 END) as sell_actions,
          COUNT(CASE WHEN action = 'hold' THEN 1 END) as hold_actions,

          -- Performance metrics
          AVG(confidence) as avg_confidence,
          STDDEV(confidence) as confidence_stddev,
          MIN(portfolio_value) as min_portfolio_value,
          MAX(portfolio_value) as max_portfolio_value,
          AVG(portfolio_value) as avg_portfolio_value,

          -- Trade performance
          COUNT(CASE WHEN trade_pnl > 0 THEN 1 END) as winning_trades,
          COUNT(CASE WHEN trade_pnl < 0 THEN 1 END) as losing_trades,
          AVG(CASE WHEN trade_pnl IS NOT NULL THEN trade_pnl END) as avg_trade_pnl,

          -- Confidence distribution
          COUNT(CASE WHEN confidence >= 0.8 THEN 1 END) as high_confidence_decisions,
          COUNT(CASE WHEN confidence >= 0.6 AND confidence < 0.8 THEN 1 END) as medium_confidence_decisions,
          COUNT(CASE WHEN confidence < 0.6 THEN 1 END) as low_confidence_decisions,

          -- Hourly distribution
          ARRAY_AGG(
            STRUCT(
              hour,
              COUNT(*) as decisions_count
            )
            ORDER BY hour
          ) as hourly_distribution,

          -- Daily performance
          ARRAY_AGG(
            STRUCT(
              date,
              COUNT(*) as decisions,
              AVG(portfolio_value) as avg_value,
              COUNT(CASE WHEN action IN ('buy', 'sell') THEN 1 END) as trades
            )
            ORDER BY date
          ) as daily_performance,

          -- Most common reasoning patterns
          ARRAY_AGG(
            DISTINCT reasoning
            ORDER BY reasoning
            LIMIT 10
          ) as sample_reasoning

        FROM decision_metrics
        `;

        const [rows] = await bigquery.query(query);

        if (rows.length === 0) {
            return res.json({
                agentId,
                analytics: {
                    summary: {},
                    performance: {},
                    patterns: {}
                },
                period,
                mode
            });
        }

        const analytics = rows[0];

        // Calculate derived metrics
        const winRate = analytics.winning_trades && analytics.losing_trades ?
            (analytics.winning_trades / (analytics.winning_trades + analytics.losing_trades)) * 100 : 0;

        const totalReturnPercent = analytics.min_portfolio_value && analytics.max_portfolio_value ?
            ((analytics.max_portfolio_value - analytics.min_portfolio_value) / analytics.min_portfolio_value) * 100 : 0;

        res.json({
            agentId,
            analytics: {
                summary: {
                    totalDecisions: parseInt(analytics.total_decisions || '0'),
                    totalTrades: parseInt(analytics.total_trades || '0'),
                    buyActions: parseInt(analytics.buy_actions || '0'),
                    sellActions: parseInt(analytics.sell_actions || '0'),
                    holdActions: parseInt(analytics.hold_actions || '0'),
                    avgConfidence: parseFloat(analytics.avg_confidence?.toFixed(3) || '0'),
                    confidenceStddev: parseFloat(analytics.confidence_stddev?.toFixed(3) || '0')
                },
                performance: {
                    portfolioValue: {
                        min: parseFloat(analytics.min_portfolio_value?.toFixed(2) || '0'),
                        max: parseFloat(analytics.max_portfolio_value?.toFixed(2) || '0'),
                        avg: parseFloat(analytics.avg_portfolio_value?.toFixed(2) || '0')
                    },
                    totalReturnPercent: parseFloat(totalReturnPercent.toFixed(2)),
                    winRate: parseFloat(winRate.toFixed(2)),
                    avgTradePnl: parseFloat(analytics.avg_trade_pnl?.toFixed(2) || '0'),
                    winningTrades: parseInt(analytics.winning_trades || '0'),
                    losingTrades: parseInt(analytics.losing_trades || '0')
                },
                patterns: {
                    confidenceDistribution: {
                        high: parseInt(analytics.high_confidence_decisions || '0'),
                        medium: parseInt(analytics.medium_confidence_decisions || '0'),
                        low: parseInt(analytics.low_confidence_decisions || '0')
                    },
                    hourlyDistribution: analytics.hourly_distribution || [],
                    dailyPerformance: analytics.daily_performance || [],
                    sampleReasoning: analytics.sample_reasoning || []
                }
            },
            period,
            mode,
            generatedAt: new Date().toISOString()
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Search trading decisions by reasoning text
 */
router.get('/search', rateLimiters.fmelSearch, async (req, res, next) => {
    try {
        const userId = req.user.uid;
        const { q, agentId, mode, limit = 50 } = req.query;

        if (!q || q.trim().length < 3) {
            return res.status(400).json({
                error: 'Search query must be at least 3 characters long'
            });
        }

        // Build WHERE conditions using parameterized queries to prevent SQL injection
        // WHY: Using query parameters prevents SQL injection attacks and allows BigQuery
        // to optimize query execution plans
        const whereConditions = [
            `user_id = @userId`,
            `JSON_EXTRACT_SCALAR(decision_data, '$.reasoning') IS NOT NULL`,
            `LOWER(JSON_EXTRACT_SCALAR(decision_data, '$.reasoning')) LIKE LOWER(@searchQuery)`
        ];

        const queryParams = {
            userId: userId,
            searchQuery: `%${q}%`,
            limit: parseInt(limit)
        };

        if (agentId) {
            whereConditions.push(`agent_id = @agentId`);
            queryParams.agentId = agentId;
        }
        if (mode) {
            whereConditions.push(`mode = @mode`);
            queryParams.mode = mode.toUpperCase();
        }

        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

        const query = `
        SELECT
          decision_id,
          timestamp,
          agent_id,
          run_id,
          mode,
          JSON_EXTRACT_SCALAR(decision_data, '$.action') as action,
          JSON_EXTRACT_SCALAR(decision_data, '$.reasoning') as reasoning,
          JSON_EXTRACT_SCALAR(decision_data, '$.confidence') as confidence,
          JSON_EXTRACT(decision_data, '$.portfolio') as portfolio,
          recorded_at
        FROM \`${PROJECT_ID}.${BQ_DATASET}.decision_analysis\`
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT @limit
        `;

        // Execute query with parameters - BigQuery client handles escaping
        const options = {
            query: query,
            params: queryParams
        };

        const [rows] = await bigquery.query(options);

        const results = rows.map(row => ({
            decisionId: row.decision_id,
            timestamp: row.timestamp,
            agentId: row.agent_id,
            sessionId: row.run_id,
            mode: row.mode,
            action: row.action,
            reasoning: row.reasoning,
            confidence: row.confidence ? parseFloat(row.confidence) : null,
            portfolio: row.portfolio,
            recordedAt: row.recorded_at
        }));

        res.json({
            query: q,
            results,
            total: results.length,
            filters: { agentId, mode },
            generatedAt: new Date().toISOString()
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Get FMEL data export for an agent
 */
router.get('/export/:agentId', async (req, res, next) => {
    try {
        const { agentId } = req.params;
        const userId = req.user.uid;
        const { format = 'json', sessionId, mode } = req.query;

        // Verify agent ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Build WHERE conditions
        const whereConditions = [`agent_id = '${agentId}'`, `user_id = '${userId}'`];

        if (sessionId) whereConditions.push(`run_id = '${sessionId}'`);
        if (mode) whereConditions.push(`mode = '${mode.toUpperCase()}'`);

        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

        const query = `
        SELECT
          decision_id,
          timestamp,
          agent_id,
          user_id,
          run_id,
          mode,
          decision_data,
          recorded_at
        FROM \`${PROJECT_ID}.${BQ_DATASET}.decision_analysis\`
        ${whereClause}
        ORDER BY timestamp ASC
        `;

        const [rows] = await bigquery.query(query);

        if (format === 'csv') {
            // Convert to CSV format
            const headers = 'decision_id,timestamp,agent_id,session_id,mode,action,reasoning,confidence,portfolio_value';
            const csvRows = rows.map(row => {
                const decisionData = JSON.parse(row.decision_data || '{}');
                return [
                    row.decision_id,
                    row.timestamp,
                    row.agent_id,
                    row.run_id,
                    row.mode,
                    decisionData.action || '',
                    `"${(decisionData.reasoning || '').replace(/"/g, '""')}"`,
                    decisionData.confidence || '',
                    decisionData.portfolio?.value || ''
                ].join(',');
            });

            const csv = [headers, ...csvRows].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=fmel-${agentId}-${Date.now()}.csv`);
            res.send(csv);

        } else {
            // JSON format
            const jsonData = {
                agentId,
                exportedAt: new Date().toISOString(),
                totalDecisions: rows.length,
                filters: { sessionId, mode },
                decisions: rows.map(row => ({
                    decisionId: row.decision_id,
                    timestamp: row.timestamp,
                    sessionId: row.run_id,
                    mode: row.mode,
                    data: JSON.parse(row.decision_data || '{}'),
                    recordedAt: row.recorded_at
                }))
            };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=fmel-${agentId}-${Date.now()}.json`);
            res.json(jsonData);
        }

    } catch (error) {
        next(error);
    }
});

module.exports = router;