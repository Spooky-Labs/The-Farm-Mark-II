/**
 * Backtest Routes
 * Consolidates run-backtest functionality
 */

const express = require('express');
const { CloudBuildClient } = require('@google-cloud/cloudbuild');
const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');
const { v4: uuidv4 } = require('uuid');
const { rateLimiters } = require('../middleware/auth');

const router = express.Router();

// Initialize clients
const buildClient = new CloudBuildClient();
const firestore = new Firestore();
const storage = new Storage();

const PROJECT_ID = process.env.PROJECT_ID;
const REGION = process.env.REGION || 'us-central1';
const WORKER_POOL = `projects/${PROJECT_ID}/locations/${REGION}/workerPools/secure-pool`;

/**
 * Start a new backtest
 */
router.post('/start', rateLimiters.runBacktest, async (req, res, next) => {
    try {
        const {
            agentId,
            startDate = '2023-01-01',
            endDate = '2023-12-31',
            initialCash = 100000,
            symbols = ['SPY'],
            timeframe = '1Day'
        } = req.body;

        const userId = req.user.uid;

        // Validate inputs
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

        // Generate session ID
        const sessionId = uuidv4();

        // Create backtest session document
        const sessionDoc = {
            sessionId,
            agentId,
            userId,
            status: 'pending',
            config: {
                startDate,
                endDate,
                initialCash,
                symbols,
                timeframe
            },
            createdAt: new Date(),
            buildId: null,
            results: null
        };

        await firestore.collection('backtestSessions').doc(sessionId).set(sessionDoc);

        // Create Cloud Build configuration
        const buildConfig = {
            projectId: PROJECT_ID,
            build: {
                steps: [
                    {
                        name: 'gcr.io/cloud-builders/docker',
                        entrypoint: 'bash',
                        args: [
                            '-c',
                            `
                            # Download agent code
                            gsutil cp gs://${PROJECT_ID}-agent-code/agents/${userId}/${agentId}/strategy.py ./agent/strategy.py

                            # Build container with agent code
                            docker build -t backtest-${sessionId} -f containers/backtest-runner/Dockerfile .

                            # Run backtest with FMEL recording
                            docker run --rm \
                              --network=none \
                              --read-only \
                              --tmpfs /tmp:rw,noexec,nosuid,size=100m \
                              -e AGENT_ID=${agentId} \
                              -e USER_ID=${userId} \
                              -e SESSION_ID=${sessionId} \
                              -e MODE=BACKTEST \
                              -e START_DATE=${startDate} \
                              -e END_DATE=${endDate} \
                              -e INITIAL_CASH=${initialCash} \
                              -e SYMBOLS="${symbols.join(',')}" \
                              -e TIMEFRAME=${timeframe} \
                              -e GOOGLE_APPLICATION_CREDENTIALS=/workspace/key.json \
                              -v /workspace/results:/results \
                              backtest-${sessionId} \
                              > /workspace/results/output.json

                            # Upload results to storage
                            gsutil cp /workspace/results/output.json gs://${PROJECT_ID}-backtest-results/${sessionId}/results.json
                            `
                        ]
                    }
                ],
                options: {
                    workerPool: WORKER_POOL,
                    machineType: 'E2_STANDARD_2',
                    diskSizeGb: 20,
                    logging: 'CLOUD_LOGGING_ONLY'
                },
                timeout: '1800s', // 30 minutes
                substitutions: {
                    _AGENT_ID: agentId,
                    _USER_ID: userId,
                    _SESSION_ID: sessionId
                }
            }
        };

        // Submit build
        const [operation] = await buildClient.createBuild({
            projectId: PROJECT_ID,
            build: buildConfig.build
        });

        const buildId = operation.name.split('/').pop();

        // Update session with build ID
        await firestore.collection('backtestSessions').doc(sessionId).update({
            buildId,
            status: 'running',
            startedAt: new Date()
        });

        // Update agent backtest count
        await firestore.collection('agents').doc(agentId).update({
            backtestCount: (agentData.backtestCount || 0) + 1,
            lastBacktestAt: new Date()
        });

        console.log(`Backtest started: ${sessionId} for agent ${agentId} by user ${userId}`);

        res.status(202).json({
            success: true,
            sessionId,
            buildId,
            message: 'Backtest started successfully',
            config: sessionDoc.config,
            trackingUrl: `https://console.cloud.google.com/cloud-build/builds/${buildId}?project=${PROJECT_ID}`
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Get backtest status
 */
router.get('/status/:sessionId', async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.uid;

        const sessionDoc = await firestore.collection('backtestSessions').doc(sessionId).get();

        if (!sessionDoc.exists) {
            return res.status(404).json({ error: 'Backtest session not found' });
        }

        const sessionData = sessionDoc.data();

        // Verify ownership
        if (sessionData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Check build status if still running
        if (sessionData.status === 'running' && sessionData.buildId) {
            try {
                const [build] = await buildClient.getBuild({
                    projectId: PROJECT_ID,
                    id: sessionData.buildId
                });

                // Update status based on build status
                let newStatus = sessionData.status;
                if (build.status === 'SUCCESS') {
                    newStatus = 'completed';
                } else if (build.status === 'FAILURE' || build.status === 'CANCELLED') {
                    newStatus = 'failed';
                } else if (build.status === 'TIMEOUT') {
                    newStatus = 'timeout';
                }

                if (newStatus !== sessionData.status) {
                    await firestore.collection('backtestSessions').doc(sessionId).update({
                        status: newStatus,
                        completedAt: new Date()
                    });
                    sessionData.status = newStatus;
                }

            } catch (buildError) {
                console.error(`Failed to get build status: ${buildError.message}`);
            }
        }

        res.json({
            sessionId,
            status: sessionData.status,
            config: sessionData.config,
            createdAt: sessionData.createdAt.toDate().toISOString(),
            startedAt: sessionData.startedAt?.toDate().toISOString(),
            completedAt: sessionData.completedAt?.toDate().toISOString(),
            results: sessionData.results,
            buildId: sessionData.buildId
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Get backtest results
 */
router.get('/results/:sessionId', async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.uid;

        const sessionDoc = await firestore.collection('backtestSessions').doc(sessionId).get();

        if (!sessionDoc.exists) {
            return res.status(404).json({ error: 'Backtest session not found' });
        }

        const sessionData = sessionDoc.data();

        // Verify ownership
        if (sessionData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (sessionData.status !== 'completed') {
            return res.status(400).json({
                error: 'Backtest not completed',
                status: sessionData.status
            });
        }

        // Try to get results from storage if not in Firestore
        if (!sessionData.results) {
            try {
                const bucket = storage.bucket(`${PROJECT_ID}-backtest-results`);
                const file = bucket.file(`${sessionId}/results.json`);

                const [exists] = await file.exists();
                if (exists) {
                    const [content] = await file.download();
                    const results = JSON.parse(content.toString());

                    // Cache results in Firestore for faster future access
                    await firestore.collection('backtestSessions').doc(sessionId).update({
                        results
                    });

                    return res.json({
                        sessionId,
                        results,
                        config: sessionData.config
                    });
                }
            } catch (storageError) {
                console.error(`Failed to retrieve results from storage: ${storageError.message}`);
            }
        }

        res.json({
            sessionId,
            results: sessionData.results,
            config: sessionData.config
        });

    } catch (error) {
        next(error);
    }
});

/**
 * List user's backtest sessions
 */
router.get('/sessions', async (req, res, next) => {
    try {
        const userId = req.user.uid;
        const { page = 1, limit = 20, status, agentId } = req.query;

        let query = firestore
            .collection('backtestSessions')
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
                completedAt: data.completedAt?.toDate().toISOString()
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
 * Cancel a running backtest
 */
router.post('/cancel/:sessionId', async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.uid;

        const sessionDoc = await firestore.collection('backtestSessions').doc(sessionId).get();

        if (!sessionDoc.exists) {
            return res.status(404).json({ error: 'Backtest session not found' });
        }

        const sessionData = sessionDoc.data();

        // Verify ownership
        if (sessionData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (sessionData.status !== 'running') {
            return res.status(400).json({
                error: 'Cannot cancel backtest',
                status: sessionData.status
            });
        }

        // Cancel the Cloud Build
        if (sessionData.buildId) {
            try {
                await buildClient.cancelBuild({
                    projectId: PROJECT_ID,
                    id: sessionData.buildId
                });
            } catch (buildError) {
                console.error(`Failed to cancel build: ${buildError.message}`);
            }
        }

        // Update session status
        await firestore.collection('backtestSessions').doc(sessionId).update({
            status: 'cancelled',
            cancelledAt: new Date()
        });

        res.json({
            success: true,
            sessionId,
            message: 'Backtest cancelled successfully'
        });

    } catch (error) {
        next(error);
    }
});

module.exports = router;