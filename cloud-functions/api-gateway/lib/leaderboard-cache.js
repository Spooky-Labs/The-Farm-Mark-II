/**
 * Leaderboard Cache using Redis (Memorystore)
 * Provides fast leaderboard queries with native sorted set support
 */

const redis = require('redis');
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.PROJECT_ID;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// Initialize clients
const bigquery = new BigQuery();
let redisClient = null;

/**
 * Initialize Redis connection
 */
async function initRedis() {
    if (!redisClient) {
        redisClient = redis.createClient({
            socket: {
                host: REDIS_HOST,
                port: REDIS_PORT
            }
        });

        redisClient.on('error', (err) => {
            console.error('Redis Client Error:', err);
        });

        await redisClient.connect();
        console.log('Redis connected successfully');
    }
    return redisClient;
}

/**
 * Leaderboard Cache Manager
 */
class LeaderboardCache {
    constructor() {
        this.CACHE_TTL = 300; // 5 minutes
        this.REFRESH_THRESHOLD = 60; // Refresh if older than 1 minute
    }

    /**
     * Get leaderboard (from cache or BigQuery)
     */
    async getLeaderboard({ mode = 'backtest', metric = 'total_pnl', period = '30d', limit = 100 }) {
        const client = await initRedis();
        const cacheKey = `leaderboard:${mode}:${metric}:${period}`;
        const timestampKey = `${cacheKey}:timestamp`;

        try {
            // Check cache age
            const lastUpdate = await client.get(timestampKey);
            const cacheAge = lastUpdate ? Date.now() - parseInt(lastUpdate) : Infinity;

            // Return cached data if fresh
            if (cacheAge < this.REFRESH_THRESHOLD * 1000) {
                const cached = await this._getFromRedis(cacheKey, limit);
                if (cached.length > 0) {
                    return {
                        source: 'cache',
                        cached_at: new Date(parseInt(lastUpdate)).toISOString(),
                        data: cached
                    };
                }
            }

            // Refresh cache in background if stale
            if (cacheAge > this.REFRESH_THRESHOLD * 1000) {
                // Don't await - let it refresh in background
                this._refreshCache(mode, metric, period).catch(err => {
                    console.error('Background cache refresh failed:', err);
                });

                // If cache exists but stale, return it while refreshing
                if (lastUpdate) {
                    const cached = await this._getFromRedis(cacheKey, limit);
                    if (cached.length > 0) {
                        return {
                            source: 'cache (refreshing)',
                            cached_at: new Date(parseInt(lastUpdate)).toISOString(),
                            data: cached
                        };
                    }
                }
            }

            // No cache or cache empty - query directly
            return await this._refreshCache(mode, metric, period);

        } catch (error) {
            console.error('Leaderboard cache error:', error);
            // Fallback to direct BigQuery
            return await this._queryBigQuery(mode, metric, period);
        }
    }

    /**
     * Get specific agent rank
     */
    async getAgentRank(agentId, { mode = 'backtest', metric = 'total_pnl', period = '30d' }) {
        const client = await initRedis();
        const cacheKey = `leaderboard:${mode}:${metric}:${period}`;

        try {
            const rank = await client.zRevRank(cacheKey, agentId);
            if (rank === null) {
                return null;
            }

            const score = await client.zScore(cacheKey, agentId);

            return {
                agent_id: agentId,
                rank: rank + 1, // Redis is 0-indexed
                score: parseFloat(score)
            };

        } catch (error) {
            console.error('Error getting agent rank:', error);
            return null;
        }
    }

    /**
     * Update single agent score (called when FMEL records are written)
     */
    async updateAgentScore(agentId, { mode = 'backtest', metric = 'total_pnl', period = '30d', score }) {
        const client = await initRedis();
        const cacheKey = `leaderboard:${mode}:${metric}:${period}`;

        try {
            await client.zAdd(cacheKey, {
                score: score,
                value: agentId
            });

            // Set expiry on the leaderboard
            await client.expire(cacheKey, this.CACHE_TTL);

        } catch (error) {
            console.error('Error updating agent score:', error);
        }
    }

    /**
     * Get leaderboard from Redis
     */
    async _getFromRedis(cacheKey, limit) {
        const client = await initRedis();

        try {
            // Get top N from sorted set with scores
            const results = await client.zRevRangeWithScores(cacheKey, 0, limit - 1);

            return results.map((item, index) => ({
                rank: index + 1,
                agent_id: item.value,
                score: item.score
            }));

        } catch (error) {
            console.error('Error reading from Redis:', error);
            return [];
        }
    }

    /**
     * Refresh cache from BigQuery
     */
    async _refreshCache(mode, metric, period) {
        const result = await this._queryBigQuery(mode, metric, period);
        const client = await initRedis();
        const cacheKey = `leaderboard:${mode}:${metric}:${period}`;
        const timestampKey = `${cacheKey}:timestamp`;

        try {
            // Clear existing cache
            await client.del(cacheKey);

            // Populate sorted set
            if (result.data && result.data.length > 0) {
                const members = result.data.map(item => ({
                    score: item.score,
                    value: item.agent_id
                }));

                await client.zAdd(cacheKey, members);
                await client.expire(cacheKey, this.CACHE_TTL);
                await client.set(timestampKey, Date.now().toString(), { EX: this.CACHE_TTL });
            }

            return result;

        } catch (error) {
            console.error('Error refreshing cache:', error);
            return result; // Return BigQuery result even if cache fails
        }
    }

    /**
     * Query BigQuery for leaderboard data
     */
    async _queryBigQuery(mode, metric, period) {
        const periodDays = this._parsePeriod(period);
        const scoreColumn = this._getScoreColumn(metric);

        const query = `
            WITH agent_metrics AS (
                SELECT
                    agent_id,
                    user_id,
                    COUNT(*) as total_decisions,
                    SUM(CASE WHEN action_type IN ('BUY', 'SELL') THEN 1 ELSE 0 END) as total_trades,
                    SUM(trade_pnl) as total_pnl,
                    AVG(trade_pnl) as avg_trade_pnl,
                    -- Sharpe ratio
                    SAFE_DIVIDE(
                        AVG(daily_return),
                        NULLIF(STDDEV(daily_return), 0)
                    ) * SQRT(252) as sharpe_ratio,
                    -- Win rate
                    SAFE_DIVIDE(
                        SUM(CASE WHEN trade_pnl > 0 THEN 1 ELSE 0 END),
                        NULLIF(COUNT(CASE WHEN trade_pnl IS NOT NULL THEN 1 END), 0)
                    ) as win_rate,
                    MAX(portfolio_value) as max_portfolio_value,
                    MIN(portfolio_value) as min_portfolio_value,
                    MAX(timestamp) as last_active
                FROM \`${PROJECT_ID}.fmel.trading_decisions\`
                WHERE session_id IS NOT NULL
                    ${periodDays ? `AND timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${periodDays} DAY)` : ''}
                GROUP BY agent_id, user_id
                HAVING total_trades > 0
            ),
            ranked_agents AS (
                SELECT
                    agent_id,
                    user_id,
                    ${scoreColumn} as score,
                    total_trades,
                    total_pnl,
                    sharpe_ratio,
                    win_rate,
                    last_active,
                    ROW_NUMBER() OVER (ORDER BY ${scoreColumn} DESC) as rank
                FROM agent_metrics
                WHERE ${scoreColumn} IS NOT NULL
            )
            SELECT
                rank,
                agent_id,
                user_id,
                ROUND(score, 2) as score,
                total_trades,
                ROUND(total_pnl, 2) as total_pnl,
                ROUND(sharpe_ratio, 3) as sharpe_ratio,
                ROUND(win_rate, 3) as win_rate,
                last_active
            FROM ranked_agents
            ORDER BY rank
            LIMIT 1000
        `;

        const [rows] = await bigquery.query(query);

        return {
            source: 'bigquery',
            data: rows.map(row => ({
                rank: parseInt(row.rank),
                agent_id: row.agent_id,
                user_id: row.user_id,
                score: parseFloat(row.score),
                metrics: {
                    total_trades: parseInt(row.total_trades),
                    total_pnl: parseFloat(row.total_pnl),
                    sharpe_ratio: parseFloat(row.sharpe_ratio),
                    win_rate: parseFloat(row.win_rate)
                },
                last_active: row.last_active
            })),
            generated_at: new Date().toISOString()
        };
    }

    _parsePeriod(period) {
        const map = { '7d': 7, '30d': 30, '90d': 90, 'all': null };
        return map[period] || 30;
    }

    _getScoreColumn(metric) {
        const map = {
            'total_pnl': 'total_pnl',
            'sharpe_ratio': 'sharpe_ratio',
            'win_rate': 'win_rate',
            'total_trades': 'total_trades'
        };
        return map[metric] || 'total_pnl';
    }
}

module.exports = {
    LeaderboardCache,
    initRedis
};