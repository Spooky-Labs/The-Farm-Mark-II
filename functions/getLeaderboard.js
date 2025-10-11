/**
 * Get Leaderboard Function
 * Returns public rankings of trading agents
 */

const functions = require('firebase-functions');
const { BigQuery } = require('@google-cloud/bigquery');

const bigquery = new BigQuery();
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.PROJECT_ID;

/**
 * Get Leaderboard - Public rankings (no auth required)
 */
exports.getLeaderboard = functions.https.onRequest((req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.status(204).send('');
        return;
    }

    const { timeframe = 'weekly', limit = 100 } = req.query;

    // Query BigQuery for leaderboard data
    let query = `
        SELECT
            agent_id as agentId,
            agent_name as agentName,
            user_id as userId,
            total_return as totalReturn,
            sharpe_ratio as sharpeRatio,
            win_rate as winRate,
            total_trades as totalTrades
        FROM \`${PROJECT_ID}.analytics.agent_performance\`
        WHERE is_paper_trading = true
    `;

    // Add timeframe filter
    if (timeframe !== 'all') {
        const days = {
            'daily': 1,
            'weekly': 7,
            'monthly': 30
        }[timeframe] || 7;

        query += ` AND DATE(last_updated) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY)`;
    }

    query += ` ORDER BY total_return DESC LIMIT ${parseInt(limit)}`;

    bigquery.query(query)
        .then(results => {
            const [rows] = results;

            // Return response with rankings
            res.json({
                leaderboard: rows.map((row, index) => ({
                    rank: index + 1,
                    ...row
                })),
                lastUpdated: new Date().toISOString()
            });
        })
        .catch(error => {
            console.error('Error getting leaderboard:', error);

            // Return empty leaderboard if BigQuery not configured
            // This allows the function to work even without analytics setup
            res.json({
                leaderboard: [],
                lastUpdated: new Date().toISOString(),
                message: 'Leaderboard data not available'
            });
        });
});