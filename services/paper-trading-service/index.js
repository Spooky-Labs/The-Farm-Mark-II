/**
 * Paper Trading Service - Cloud Run
 * Kicks off paper trading sessions in Kubernetes after account setup
 */

const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const k8s = require('@kubernetes/client-node');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.PROJECT_ID;
const GKE_CLUSTER = process.env.GKE_CLUSTER || 'farm-cluster';
const GKE_REGION = process.env.GKE_REGION || 'us-central1';

if (!PROJECT_ID) {
    console.error('PROJECT_ID environment variable is required');
    process.exit(1);
}

// Initialize clients
const firestore = new Firestore();

// Initialize Kubernetes client
const kc = new k8s.KubeConfig();
if (process.env.NODE_ENV === 'production') {
    kc.loadFromDefault(); // In-cluster config
} else {
    kc.loadFromDefault(); // Local kubectl config
}
const k8sApi = kc.makeApiClient(k8s.AppsV1Api);

// Middleware
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'paper-trading-service',
        version: '1.0.0',
        cluster: GKE_CLUSTER
    });
});

// Start paper trading - simplified to just kick off
app.post('/api/paper-trading/start', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const {
            agentId,
            accountId,  // Alpaca account ID from external Cloud Functions
            symbols = ['SPY', 'QQQ', 'AAPL']
        } = req.body;

        if (!agentId || !accountId) {
            return res.status(400).json({
                error: 'Agent ID and Account ID are required'
            });
        }

        // Verify agent ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const sessionId = uuidv4();
        const deploymentName = `paper-trader-${agentId.substring(0, 8)}`;

        // Create Kubernetes StatefulSet for paper trading
        const statefulSet = {
            apiVersion: 'apps/v1',
            kind: 'StatefulSet',
            metadata: {
                name: deploymentName,
                namespace: 'paper-trading',
                labels: {
                    app: 'paper-trader',
                    agentId: agentId,
                    userId: userId,
                    sessionId: sessionId,
                    accountId: accountId
                }
            },
            spec: {
                serviceName: deploymentName,
                replicas: 1,
                selector: {
                    matchLabels: {
                        app: 'paper-trader',
                        agentId: agentId
                    }
                },
                template: {
                    metadata: {
                        labels: {
                            app: 'paper-trader',
                            agentId: agentId,
                            userId: userId,
                            sessionId: sessionId,
                            accountId: accountId
                        }
                    },
                    spec: {
                        serviceAccountName: 'paper-trader-sa',
                        containers: [{
                            name: 'paper-trader',
                            image: `gcr.io/${PROJECT_ID}/paper-trader:latest`,
                            env: [
                                { name: 'PROJECT_ID', value: PROJECT_ID },
                                { name: 'AGENT_ID', value: agentId },
                                { name: 'USER_ID', value: userId },
                                { name: 'SESSION_ID', value: sessionId },
                                { name: 'ACCOUNT_ID', value: accountId },
                                { name: 'MODE', value: 'PAPER' },
                                { name: 'SYMBOLS', value: symbols.join(',') },
                                { name: 'FMEL_ENABLED', value: 'true' },
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
                                    memory: '512Mi',
                                    cpu: '250m'
                                },
                                limits: {
                                    memory: '2Gi',
                                    cpu: '1'
                                }
                            }
                        }],
                        restartPolicy: 'Always'
                    }
                },
                volumeClaimTemplates: [{
                    metadata: {
                        name: 'agent-storage'
                    },
                    spec: {
                        accessModes: ['ReadWriteOnce'],
                        resources: {
                            requests: {
                                storage: '10Gi'
                            }
                        }
                    }
                }]
            }
        };

        // Deploy to Kubernetes
        try {
            await k8sApi.createNamespacedStatefulSet('paper-trading', statefulSet);
            console.log(`Deployed paper trading pod for agent ${agentId}`);
        } catch (k8sError) {
            if (k8sError.response?.statusCode === 409) {
                // Already exists
                return res.status(409).json({
                    error: 'Paper trading already running for this agent',
                    sessionId: sessionId
                });
            } else {
                throw k8sError;
            }
        }

        // Record session in Firestore
        await firestore.collection('paperTradingSessions').doc(sessionId).set({
            sessionId,
            agentId,
            accountId,
            userId,
            deploymentName,
            status: 'starting',
            symbols,
            createdAt: new Date()
        });

        // Update agent status
        await firestore.collection('agents').doc(agentId).update({
            paperTradingActive: true,
            currentSessionId: sessionId,
            alpacaAccountId: accountId,
            paperTradingStartedAt: new Date()
        });

        res.status(202).json({
            sessionId,
            status: 'starting',
            message: 'Paper trading session starting',
            deploymentName
        });

    } catch (error) {
        console.error('Error starting paper trading:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get status (simplified - just check if pod is running)
app.get('/api/paper-trading/status/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const userId = req.headers['x-user-id'];

        // Verify ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!agentData.paperTradingActive) {
            return res.json({
                agentId,
                status: 'not_running',
                message: 'No active paper trading session'
            });
        }

        // Check if pod exists in Kubernetes
        const deploymentName = `paper-trader-${agentId.substring(0, 8)}`;
        try {
            const statefulSet = await k8sApi.readNamespacedStatefulSet(
                deploymentName,
                'paper-trading'
            );

            const replicas = statefulSet.body.status.replicas || 0;
            const readyReplicas = statefulSet.body.status.readyReplicas || 0;

            res.json({
                agentId,
                status: readyReplicas > 0 ? 'running' : 'starting',
                sessionId: agentData.currentSessionId,
                replicas,
                readyReplicas
            });

        } catch (k8sError) {
            if (k8sError.response?.statusCode === 404) {
                // Pod doesn't exist
                return res.json({
                    agentId,
                    status: 'not_found',
                    message: 'Paper trading pod not found'
                });
            }
            throw k8sError;
        }

    } catch (error) {
        console.error('Error getting status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Stop paper trading (simple cleanup)
app.post('/api/paper-trading/stop', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { agentId } = req.body;

        if (!agentId) {
            return res.status(400).json({ error: 'Agent ID is required' });
        }

        // Verify ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Delete Kubernetes StatefulSet
        const deploymentName = `paper-trader-${agentId.substring(0, 8)}`;
        try {
            await k8sApi.deleteNamespacedStatefulSet(
                deploymentName,
                'paper-trading'
            );
            console.log(`Deleted paper trading pod ${deploymentName}`);
        } catch (k8sError) {
            if (k8sError.response?.statusCode !== 404) {
                console.warn(`Failed to delete StatefulSet: ${k8sError.message}`);
            }
        }

        // Update agent status
        await firestore.collection('agents').doc(agentId).update({
            paperTradingActive: false,
            currentSessionId: null,
            lastSessionId: agentData.currentSessionId
        });

        res.json({
            success: true,
            message: 'Paper trading stopped'
        });

    } catch (error) {
        console.error('Error stopping paper trading:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Paper trading service listening on port ${PORT}`);
});