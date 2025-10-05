/**
 * Leaderboard Service - Cloud Run
 * Handles leaderboard queries using Redis cache
 */

const express = require('express');
const redis = require('redis');
const { BigQuery } = require('@google-cloud/bigquery');
const { Firestore } = require('@google-cloud/firestore');

const app = express();
const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.PROJECT_ID;

if (!PROJECT_ID) {
    console.error('PROJECT_ID environment variable is required');
    process.exit(1);
}

// Redis connection (Memorystore)
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;

const redisClient = redis.createClient({
    socket: {
        host: redisHost,
        port: redisPort
    }
});

// Initialize GCP clients
const bigquery = new BigQuery();
const firestore = new Firestore();

// Connect to Redis
redisClient.on('error', (err) => console.error('Redis error:', err));
redisClient.connect();

// Middleware
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
    try {
        await redisClient.ping();
        res.json({
            status: 'healthy',
            service: 'leaderboard-service',
            redis: 'connected',
            version: '1.0.0'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            service: 'leaderboard-service',
            redis: 'disconnected'
        });
    }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const {
            type = 'paper_trading',
            metric = 'returns',
            timeframe = 'weekly',
            limit = 100
        } = req.query;

        // Create cache key
        const cacheKey = `leaderboard:${type}:${metric}:${timeframe}`;

        // Try to get from cache
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            console.log('Leaderboard served from cache');
            return res.json(JSON.parse(cached));
        }

        // If not in cache, fetch from BigQuery
        const leaderboard = await fetchLeaderboardFromBigQuery(type, metric, timeframe, limit);

        // Cache for 30 seconds
        await redisClient.setEx(cacheKey, 30, JSON.stringify(leaderboard));

        res.json(leaderboard);

    } catch (error) {
        console.error('Error getting leaderboard:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update leaderboard (called by internal services)
app.post('/api/leaderboard/update', async (req, res) => {
    try {
        const { agentId, metric, value } = req.body;

        // This endpoint should only be called by internal services
        // In production, add service-to-service auth
        const internalKey = req.headers['x-internal-key'];
        if (internalKey !== process.env.INTERNAL_API_KEY) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // Update Redis sorted sets
        const updates = [
            redisClient.zAdd('leaderboard:backtest:sharpe', { score: value.sharpe || 0, value: agentId }),
            redisClient.zAdd('leaderboard:backtest:returns', { score: value.returns || 0, value: agentId }),
            redisClient.zAdd('leaderboard:paper:daily', { score: value.daily || 0, value: agentId }),
            redisClient.zAdd('leaderboard:paper:weekly', { score: value.weekly || 0, value: agentId })
        ];

        await Promise.all(updates);

        res.json({ success: true, message: 'Leaderboard updated' });

    } catch (error) {
        console.error('Error updating leaderboard:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user rank
app.get('/api/leaderboard/rank/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const { type = 'paper_trading', metric = 'returns' } = req.query;

        const key = `leaderboard:${type}:${metric}`;

        // Get rank (Redis ranks are 0-based, so add 1)
        const rank = await redisClient.zRevRank(key, agentId);
        const score = await redisClient.zScore(key, agentId);

        if (rank === null) {
            return res.status(404).json({ error: 'Agent not found in leaderboard' });
        }

        res.json({
            agentId,
            rank: rank + 1,
            score,
            type,
            metric
        });

    } catch (error) {
        console.error('Error getting rank:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Helper function to fetch from BigQuery
async function fetchLeaderboardFromBigQuery(type, metric, timeframe, limit) {
    // Construct query based on parameters
    let query = `
        SELECT
            agent_id,
            agent_name,
            user_id,
            ${metric} as metric_value,
            last_updated
        FROM \`${PROJECT_ID}.analytics.agent_performance\`
        WHERE 1=1
    `;

    // Add timeframe filter
    if (timeframe !== 'all_time') {
        const days = {
            'daily': 1,
            'weekly': 7,
            'monthly': 30
        }[timeframe] || 7;

        query += ` AND DATE(last_updated) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY)`;
    }

    // Add type filter
    if (type === 'backtest') {
        query += ` AND is_backtest = true`;
    } else {
        query += ` AND is_paper_trading = true`;
    }

    query += ` ORDER BY ${metric} DESC LIMIT ${parseInt(limit)}`;

    const [rows] = await bigquery.query(query);

    return {
        leaderboard: rows.map((row, index) => ({
            rank: index + 1,
            agentId: row.agent_id,
            agentName: row.agent_name,
            userId: row.user_id,
            metric: row.metric_value,
            metricType: metric
        })),
        updated_at: new Date().toISOString()
    };
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing connections...');
    await redisClient.quit();
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`Leaderboard service listening on port ${PORT}`);
});