/**
 * Paper Trading Routes
 * Consolidates paper-trading functionality
 */

const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');
const k8s = require('@kubernetes/client-node');
const { v4: uuidv4 } = require('uuid');
const { rateLimiters } = require('../middleware/auth');

const router = express.Router();

// Initialize clients
const firestore = new Firestore();
const storage = new Storage();

// Kubernetes configuration
const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sAppsV1Api = kc.makeApiClient(k8s.AppsV1Api);

const PROJECT_ID = process.env.PROJECT_ID;
const REGION = process.env.REGION || 'us-central1';
const GKE_CLUSTER = process.env.GKE_CLUSTER || 'spooky-labs-cluster';
const NAMESPACE = 'paper-trading';

/**
 * Create an Alpaca paper trading account for an agent
 * Proxies to Python Cloud Function that uses Alpaca Python SDK
 *
 * Note: This is a convenience proxy. The Python function is deployed separately.
 * You can also call the broker routes directly: POST /api/broker/create-account
 */
router.post('/create-account', rateLimiters.createAccount, async (req, res, next) => {
    try {
        const { agentId } = req.body;
        const userId = req.user.uid;

        if (!agentId) {
            return res.status(400).json({
                error: 'Missing required parameter: agentId'
            });
        }

        // Verify agent exists and user owns it (security check before proxying)
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Forward request to Python Cloud Function
        const createAccountUrl = process.env.CREATE_ACCOUNT_FUNCTION_URL ||
            `https://${process.env.REGION || 'us-central1'}-${process.env.PROJECT_ID}.cloudfunctions.net/create-account`;

        const response = await fetch(createAccountUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': req.headers.authorization
            },
            body: JSON.stringify({ agentId })
        });

        const responseData = await response.json();

        return res.status(response.status).json(responseData);

    } catch (error) {
        console.error('Create account proxy error:', error);
        next(error);
    }
});

/**
 * Fund an Alpaca paper trading account for an agent
 * Proxies to Python Cloud Function that uses Alpaca Python SDK
 *
 * Note: This is a convenience proxy. The Python function is deployed separately.
 * You can also call the broker routes directly: POST /api/broker/fund-account
 */
router.post('/fund-account', rateLimiters.fundAccount, async (req, res, next) => {
    try {
        const { agentId, amount } = req.body;
        const userId = req.user.uid;

        if (!agentId) {
            return res.status(400).json({
                error: 'Missing required parameter: agentId'
            });
        }

        // Verify agent exists and user owns it (security check before proxying)
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Forward request to Python Cloud Function
        const fundAccountUrl = process.env.FUND_ACCOUNT_FUNCTION_URL ||
            `https://${process.env.REGION || 'us-central1'}-${process.env.PROJECT_ID}.cloudfunctions.net/fund-account`;

        const response = await fetch(fundAccountUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': req.headers.authorization
            },
            body: JSON.stringify({ agentId, amount })
        });

        const responseData = await response.json();

        return res.status(response.status).json(responseData);

    } catch (error) {
        console.error('Fund account proxy error:', error);
        next(error);
    }
});

/**
 * Start paper trading for an agent
 *
 * Requirements:
 * - Agent must have an Alpaca account created (use /create-account)
 * - Account must be funded (use /fund-account)
 */
router.post('/start', rateLimiters.paperTradingStart, async (req, res, next) => {
    try {
        const { agentId, initialCash = 100000, riskLevel = 'medium' } = req.body;
        const userId = req.user.uid;

        if (!agentId) {
            return res.status(400).json({ error: 'Agent ID is required' });
        }

        // Verify agent exists and user owns it
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Check if Alpaca account exists and is funded
        if (!agentData.alpacaAccountCreated) {
            return res.status(400).json({
                error: 'No Alpaca account exists for this agent',
                message: 'Please create an account first using POST /api/paper-trading/create-account',
                agentId: agentId
            });
        }

        if (!agentData.alpacaAccountFunded) {
            return res.status(400).json({
                error: 'Alpaca account is not funded',
                message: 'Please fund the account first using POST /api/paper-trading/fund-account',
                agentId: agentId
            });
        }

        // Check if agent is already paper trading
        if (agentData.paperTradingActive) {
            return res.status(400).json({
                error: 'Agent is already paper trading',
                sessionId: agentData.currentPaperTradingSession
            });
        }

        // Check user's concurrent paper trading limit
        const activeSessions = await firestore
            .collection('paperTradingSessions')
            .where('userId', '==', userId)
            .where('status', '==', 'running')
            .get();

        const maxConcurrentSessions = parseInt(process.env.MAX_CONCURRENT_PAPER_TRADING) || 10;
        if (activeSessions.size >= maxConcurrentSessions) {
            return res.status(429).json({
                error: `Maximum concurrent paper trading sessions reached (${maxConcurrentSessions})`
            });
        }

        // Generate session ID
        const sessionId = uuidv4();

        // Create paper trading session document
        const sessionDoc = {
            sessionId,
            agentId,
            userId,
            status: 'starting',
            config: {
                initialCash,
                riskLevel
            },
            metrics: {
                portfolioValue: initialCash,
                cash: initialCash,
                totalReturn: 0,
                dailyReturn: 0,
                totalTrades: 0,
                winRate: 0
            },
            createdAt: new Date(),
            startedAt: null,
            kubernetesDeployment: `paper-trader-${agentId}`,
            lastHeartbeat: null
        };

        await firestore.collection('paperTradingSessions').doc(sessionId).set(sessionDoc);

        // Create Kubernetes StatefulSet
        const statefulSetSpec = createPaperTradingStatefulSet(agentId, userId, sessionId, initialCash);

        try {
            await k8sAppsV1Api.createNamespacedStatefulSet(NAMESPACE, statefulSetSpec);

            // Update session status
            await firestore.collection('paperTradingSessions').doc(sessionId).update({
                status: 'running',
                startedAt: new Date()
            });

            // Update agent status
            await firestore.collection('agents').doc(agentId).update({
                paperTradingActive: true,
                currentPaperTradingSession: sessionId
            });

            console.log(`Paper trading started: ${sessionId} for agent ${agentId} by user ${userId}`);

            res.status(202).json({
                success: true,
                sessionId,
                message: 'Paper trading started successfully',
                config: sessionDoc.config,
                kubernetesDeployment: sessionDoc.kubernetesDeployment
            });

        } catch (k8sError) {
            // Cleanup on failure
            await firestore.collection('paperTradingSessions').doc(sessionId).update({
                status: 'failed',
                error: k8sError.message,
                failedAt: new Date()
            });

            throw new Error(`Failed to start Kubernetes deployment: ${k8sError.message}`);
        }

    } catch (error) {
        next(error);
    }
});

/**
 * Stop paper trading for an agent
 */
router.post('/stop', rateLimiters.paperTradingStop, async (req, res, next) => {
    try {
        const { agentId, sessionId } = req.body;
        const userId = req.user.uid;

        if (!agentId && !sessionId) {
            return res.status(400).json({ error: 'Either agentId or sessionId is required' });
        }

        let session;
        if (sessionId) {
            const sessionDoc = await firestore.collection('paperTradingSessions').doc(sessionId).get();
            if (!sessionDoc.exists) {
                return res.status(404).json({ error: 'Paper trading session not found' });
            }
            session = { id: sessionDoc.id, ...sessionDoc.data() };
        } else {
            // Find active session by agent ID
            const activeSessions = await firestore
                .collection('paperTradingSessions')
                .where('agentId', '==', agentId)
                .where('userId', '==', userId)
                .where('status', '==', 'running')
                .limit(1)
                .get();

            if (activeSessions.empty) {
                return res.status(404).json({ error: 'No active paper trading session found for this agent' });
            }

            const sessionDoc = activeSessions.docs[0];
            session = { id: sessionDoc.id, ...sessionDoc.data() };
        }

        // Verify ownership
        if (session.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (session.status !== 'running') {
            return res.status(400).json({
                error: 'Paper trading session is not running',
                status: session.status
            });
        }

        try {
            // Delete Kubernetes StatefulSet
            await k8sAppsV1Api.deleteNamespacedStatefulSet(
                session.kubernetesDeployment,
                NAMESPACE,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                { propagationPolicy: 'Background' }
            );

            // Update session status
            await firestore.collection('paperTradingSessions').doc(session.id).update({
                status: 'stopped',
                stoppedAt: new Date()
            });

            // Update agent status
            await firestore.collection('agents').doc(session.agentId).update({
                paperTradingActive: false,
                currentPaperTradingSession: null,
                lastPaperTradingSession: session.id
            });

            console.log(`Paper trading stopped: ${session.id} for agent ${session.agentId} by user ${userId}`);

            res.json({
                success: true,
                sessionId: session.id,
                message: 'Paper trading stopped successfully'
            });

        } catch (k8sError) {
            console.error(`Failed to delete Kubernetes deployment: ${k8sError.message}`);

            // Update status even if Kubernetes deletion failed
            await firestore.collection('paperTradingSessions').doc(session.id).update({
                status: 'stopping_failed',
                error: k8sError.message,
                failedAt: new Date()
            });

            throw new Error(`Failed to stop Kubernetes deployment: ${k8sError.message}`);
        }

    } catch (error) {
        next(error);
    }
});

/**
 * Get paper trading session status
 */
router.get('/status/:sessionId', async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.uid;

        const sessionDoc = await firestore.collection('paperTradingSessions').doc(sessionId).get();

        if (!sessionDoc.exists) {
            return res.status(404).json({ error: 'Paper trading session not found' });
        }

        const sessionData = sessionDoc.data();

        // Verify ownership
        if (sessionData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({
            sessionId,
            status: sessionData.status,
            config: sessionData.config,
            metrics: sessionData.metrics,
            createdAt: sessionData.createdAt.toDate().toISOString(),
            startedAt: sessionData.startedAt?.toDate().toISOString(),
            stoppedAt: sessionData.stoppedAt?.toDate().toISOString(),
            lastHeartbeat: sessionData.lastHeartbeat?.toDate().toISOString(),
            kubernetesDeployment: sessionData.kubernetesDeployment
        });

    } catch (error) {
        next(error);
    }
});

/**
 * List user's paper trading sessions
 */
router.get('/sessions', async (req, res, next) => {
    try {
        const userId = req.user.uid;
        const { page = 1, limit = 20, status, agentId } = req.query;

        let query = firestore
            .collection('paperTradingSessions')
            .where('userId', '==', userId);

        if (status) {
            query = query.where('status', '==', status);
        }

        if (agentId) {
            query = query.where('agentId', '==', agentId);
        }

        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit))
            .offset((parseInt(page) - 1) * parseInt(limit))
            .get();

        const sessions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                sessionId: doc.id,
                ...data,
                createdAt: data.createdAt.toDate().toISOString(),
                startedAt: data.startedAt?.toDate().toISOString(),
                stoppedAt: data.stoppedAt?.toDate().toISOString(),
                lastHeartbeat: data.lastHeartbeat?.toDate().toISOString()
            };
        });

        res.json({
            sessions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: snapshot.size
            }
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Update paper trading metrics (called by the paper trader container)
 */
router.post('/heartbeat/:sessionId', async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { metrics, trades, positions } = req.body;
        const userId = req.user.uid;

        const sessionDoc = await firestore.collection('paperTradingSessions').doc(sessionId).get();

        if (!sessionDoc.exists) {
            return res.status(404).json({ error: 'Paper trading session not found' });
        }

        const sessionData = sessionDoc.data();

        // Verify ownership
        if (sessionData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Update session with latest metrics
        const updates = {
            lastHeartbeat: new Date()
        };

        if (metrics) {
            updates.metrics = {
                ...sessionData.metrics,
                ...metrics
            };
        }

        if (trades) {
            updates.recentTrades = trades.slice(-10); // Keep last 10 trades
        }

        if (positions) {
            updates.currentPositions = positions;
        }

        await firestore.collection('paperTradingSessions').doc(sessionId).update(updates);

        res.json({
            success: true,
            message: 'Heartbeat received',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Helper function to create Kubernetes StatefulSet specification
 */
function createPaperTradingStatefulSet(agentId, userId, sessionId, initialCash) {
    const name = `paper-trader-${agentId}`;

    return {
        apiVersion: 'apps/v1',
        kind: 'StatefulSet',
        metadata: {
            name,
            namespace: NAMESPACE,
            labels: {
                app: 'paper-trader',
                agentId,
                userId,
                sessionId
            }
        },
        spec: {
            serviceName: name,
            replicas: 1,
            selector: {
                matchLabels: {
                    app: 'paper-trader',
                    agentId
                }
            },
            template: {
                metadata: {
                    labels: {
                        app: 'paper-trader',
                        agentId,
                        userId,
                        sessionId
                    }
                },
                spec: {
                    serviceAccountName: 'paper-trading-sa',
                    containers: [
                        {
                            name: 'paper-trader',
                            image: `${REGION}-docker.pkg.dev/${PROJECT_ID}/spooky-labs/paper-trader:latest`,
                            env: [
                                { name: 'AGENT_ID', value: agentId },
                                { name: 'USER_ID', value: userId },
                                { name: 'SESSION_ID', value: sessionId },
                                { name: 'MODE', value: 'PAPER' },
                                { name: 'INITIAL_CASH', value: initialCash.toString() },
                                { name: 'PROJECT_ID', value: PROJECT_ID },
                                {
                                    name: 'ALPACA_API_KEY',
                                    valueFrom: {
                                        secretKeyRef: {
                                            name: 'alpaca-credentials',
                                            key: 'api-key'
                                        }
                                    }
                                },
                                {
                                    name: 'ALPACA_SECRET_KEY',
                                    valueFrom: {
                                        secretKeyRef: {
                                            name: 'alpaca-credentials',
                                            key: 'secret-key'
                                        }
                                    }
                                }
                            ],
                            resources: {
                                requests: {
                                    cpu: '500m',
                                    memory: '1Gi'
                                },
                                limits: {
                                    cpu: '2',
                                    memory: '4Gi'
                                }
                            },
                            livenessProbe: {
                                httpGet: {
                                    path: '/health',
                                    port: 8080
                                },
                                initialDelaySeconds: 30,
                                periodSeconds: 30
                            },
                            readinessProbe: {
                                httpGet: {
                                    path: '/ready',
                                    port: 8080
                                },
                                initialDelaySeconds: 10,
                                periodSeconds: 10
                            }
                        }
                    ],
                    restartPolicy: 'Always'
                }
            }
        }
    };
}

module.exports = router;