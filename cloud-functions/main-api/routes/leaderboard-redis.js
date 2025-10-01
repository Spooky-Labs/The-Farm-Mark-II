/**
 * Leaderboard Routes with Redis Caching
 * High-performance public leaderboard using Memorystore
 */

const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const { LeaderboardCache } = require('../lib/leaderboard-cache');

const router = express.Router();

// Initialize
const firestore = new Firestore();
const leaderboardCache = new LeaderboardCache();

/**
 * Get leaderboard
 * Public endpoint - no auth required
 */
router.get('/', async (req, res, next) => {
    try {
        const {
            mode = 'backtest',      // 'backtest' or 'paper'
            metric = 'total_pnl',    // 'total_pnl', 'sharpe_ratio', 'win_rate'
            period = '30d',          // '7d', '30d', '90d', 'all'
            limit = 100              // Max 1000
        } = req.query;

        // Validate inputs
        const validModes = ['backtest', 'paper'];
        const validMetrics = ['total_pnl', 'sharpe_ratio', 'win_rate', 'total_trades'];
        const validPeriods = ['7d', '30d', '90d', 'all'];

        if (!validModes.includes(mode)) {
            return res.status(400).json({
                error: 'Invalid mode',
                valid_values: validModes
            });
        }

        if (!validMetrics.includes(metric)) {
            return res.status(400).json({
                error: 'Invalid metric',
                valid_values: validMetrics
            });
        }

        if (!validPeriods.includes(period)) {
            return res.status(400).json({
                error: 'Invalid period',
                valid_values: validPeriods
            });
        }

        const parsedLimit = Math.min(parseInt(limit) || 100, 1000);

        // Get leaderboard from cache (or BigQuery if cache miss)
        const result = await leaderboardCache.getLeaderboard({
            mode,
            metric,
            period,
            limit: parsedLimit
        });

        // Enrich with agent metadata for public agents
        const enrichedData = await enrichWithAgentMetadata(result.data);

        res.json({
            leaderboard: enrichedData,
            metadata: {
                mode,
                metric,
                period,
                limit: parsedLimit,
                source: result.source,
                cached_at: result.cached_at,
                generated_at: result.generated_at || new Date().toISOString()
            }
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Get specific agent's rank and position
 * Public endpoint for individual agent lookup
 */
router.get('/agent/:agentId', async (req, res, next) => {
    try {
        const { agentId } = req.params;
        const {
            mode = 'backtest',
            metric = 'total_pnl',
            period = '30d'
        } = req.query;

        // Get agent metadata (only if public)
        const agentDoc = await firestore.collection('agents').doc(agentId).get();

        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();

        // Only show public agents in leaderboard
        if (agentData.visibility !== 'public') {
            return res.status(403).json({
                error: 'Agent leaderboard position is not public'
            });
        }

        // Get rank from Redis
        const rankData = await leaderboardCache.getAgentRank(agentId, {
            mode,
            metric,
            period
        });

        if (!rankData) {
            return res.status(404).json({
                error: 'Agent not found in leaderboard',
                hint: 'Agent may not have completed any trades yet'
            });
        }

        res.json({
            agent_id: agentId,
            agent_name: agentData.agentName,
            description: agentData.description || '',
            tags: agentData.tags || [],
            rank: rankData.rank,
            score: rankData.score,
            metric: metric,
            mode: mode,
            period: period,
            created_at: agentData.createdAt.toDate().toISOString()
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Get leaderboard statistics
 * Public endpoint for platform stats
 */
router.get('/stats', async (req, res, next) => {
    try {
        // Get total agents from Firestore
        const publicAgents = await firestore
            .collection('agents')
            .where('visibility', '==', 'public')
            .count()
            .get();

        const totalAgents = publicAgents.data().count;

        // Get active agents from both leaderboards
        const [backtestBoard, paperBoard] = await Promise.all([
            leaderboardCache.getLeaderboard({
                mode: 'backtest',
                metric: 'total_pnl',
                period: '30d',
                limit: 1000
            }),
            leaderboardCache.getLeaderboard({
                mode: 'paper',
                metric: 'total_pnl',
                period: '30d',
                limit: 1000
            })
        ]);

        const backtestActive = backtestBoard.data?.length || 0;
        const paperActive = paperBoard.data?.length || 0;

        // Calculate aggregate stats
        const aggregateStats = calculateAggregateStats([
            ...(backtestBoard.data || []),
            ...(paperBoard.data || [])
        ]);

        res.json({
            platform: {
                total_public_agents: totalAgents,
                active_backtest_agents: backtestActive,
                active_paper_agents: paperActive,
                total_active_agents: backtestActive + paperActive
            },
            performance: aggregateStats,
            generated_at: new Date().toISOString()
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Enrich leaderboard data with agent metadata
 */
async function enrichWithAgentMetadata(leaderboardData) {
    if (!leaderboardData || leaderboardData.length === 0) {
        return [];
    }

    const agentIds = leaderboardData.map(item => item.agent_id);

    // Get all public agents in one query
    const agentDocs = await firestore
        .collection('agents')
        .where('visibility', '==', 'public')
        .get();

    const agentMetadata = {};
    agentDocs.forEach(doc => {
        const data = doc.data();
        if (agentIds.includes(data.agentId)) {
            agentMetadata[data.agentId] = {
                name: data.agentName,
                description: data.description || '',
                tags: data.tags || [],
                created_at: data.createdAt.toDate().toISOString()
            };
        }
    });

    // Enrich leaderboard entries
    return leaderboardData.map(item => ({
        rank: item.rank,
        agent_id: item.agent_id,
        agent_name: agentMetadata[item.agent_id]?.name || 'Anonymous Agent',
        description: agentMetadata[item.agent_id]?.description || '',
        tags: agentMetadata[item.agent_id]?.tags || [],
        score: item.score,
        metrics: item.metrics,
        last_active: item.last_active
    }));
}

/**
 * Calculate aggregate statistics
 */
function calculateAggregateStats(allAgents) {
    if (allAgents.length === 0) {
        return {
            total_trades: 0,
            total_pnl: 0,
            avg_pnl: 0,
            avg_sharpe: 0,
            avg_win_rate: 0
        };
    }

    const totalTrades = allAgents.reduce((sum, a) => sum + (a.metrics?.total_trades || 0), 0);
    const totalPnl = allAgents.reduce((sum, a) => sum + (a.metrics?.total_pnl || 0), 0);
    const avgPnl = totalPnl / allAgents.length;

    const sharpeRatios = allAgents
        .map(a => a.metrics?.sharpe_ratio)
        .filter(s => s != null && !isNaN(s));
    const avgSharpe = sharpeRatios.length > 0
        ? sharpeRatios.reduce((sum, s) => sum + s, 0) / sharpeRatios.length
        : 0;

    const winRates = allAgents
        .map(a => a.metrics?.win_rate)
        .filter(w => w != null && !isNaN(w));
    const avgWinRate = winRates.length > 0
        ? winRates.reduce((sum, w) => sum + w, 0) / winRates.length
        : 0;

    return {
        total_trades: totalTrades,
        total_pnl: parseFloat(totalPnl.toFixed(2)),
        avg_pnl: parseFloat(avgPnl.toFixed(2)),
        avg_sharpe: parseFloat(avgSharpe.toFixed(3)),
        avg_win_rate: parseFloat(avgWinRate.toFixed(3))
    };
}

module.exports = router;