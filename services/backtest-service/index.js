/**
 * Backtest Service - Cloud Run
 * Handles backtest operations via Cloud Build
 */

const express = require('express');
const { CloudBuildClient } = require('@google-cloud/cloudbuild');
const { Firestore } = require('@google-cloud/firestore');
const { PubSub } = require('@google-cloud/pubsub');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.PROJECT_ID;
const REGION = process.env.REGION || 'us-central1';

if (!PROJECT_ID) {
    console.error('PROJECT_ID environment variable is required');
    process.exit(1);
}

// Initialize clients
const cloudbuild = new CloudBuildClient();
const firestore = new Firestore();
const pubsub = new PubSub();

// Middleware
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'backtest-service',
        version: '1.0.0'
    });
});

// Start backtest for an agent
app.post('/api/backtest/:agentId/start', async (req, res) => {
    try {
        const { agentId } = req.params;
        const userId = req.headers['x-user-id'];
        const {
            startDate = '2023-01-01',
            endDate = '2023-12-31',
            initialCash = 100000,
            symbols = ['SPY', 'QQQ', 'AAPL']
        } = req.body;

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
        const imageName = `${REGION}-docker.pkg.dev/${PROJECT_ID}/spooky-labs/backtest-runner:${agentId}`;
        const sourceLocation = `gs://${PROJECT_ID}-agent-code/agents/${userId}/${agentId}`;

        // Validate required parameters
        if (!startDate || !endDate) {
            return res.status(400).json({
                error: 'Start date and end date are required for backtesting'
            });
        }

        // Ensure dates are in correct format
        const startDateObj = new Date(startDate);
        const endDateObj = new Date(endDate);

        if (startDateObj >= endDateObj) {
            return res.status(400).json({
                error: 'Start date must be before end date'
            });
        }

        // Update agent status
        await firestore.collection('agents').doc(agentId).update({
            status: 'backtesting',
            backtestStartedAt: new Date(),
            lastBacktestSessionId: sessionId
        });

        // Create Cloud Build configuration using Course-1 modular architecture
        const buildConfig = {
            steps: [
                // Clone Course-1 backtesting environment
                {
                    name: 'gcr.io/cloud-builders/git',
                    args: ['clone', 'https://github.com/Spooky-Labs/Course-1.git'],
                    id: 'clone-course-1',
                    entrypoint: 'git',
                },
                // Move required files to workspace
                {
                    name: 'ubuntu',
                    args: ['-c', 'mv /workspace/Course-1/* /workspace/'],
                    id: 'move-files',
                    entrypoint: 'bash',
                },
                // Create data directory
                {
                    name: 'ubuntu',
                    args: ['-c', 'mkdir -p /workspace/data'],
                    id: 'create-data-dir',
                    entrypoint: 'bash',
                },
                // Download market data
                {
                    name: 'gcr.io/cloud-builders/gsutil',
                    args: ['cp', '-r', `gs://${PROJECT_ID}-market-data/*`, '/workspace/data/'],
                    id: 'download-market-data',
                },
                // Download agent code
                {
                    name: 'gcr.io/cloud-builders/gsutil',
                    args: ['cp', '-r', sourceLocation, '/workspace/agent'],
                    id: 'download-agent-code'
                },
                // Build Docker image
                {
                    name: 'gcr.io/cloud-builders/docker',
                    args: ['build', '-t', imageName, '.'],
                    id: 'build-image'
                },
                // Run backtest with isolation
                {
                    name: 'gcr.io/cloud-builders/docker',
                    entrypoint: 'bash',
                    args: [
                        '-c',
                        `docker run \\
                         --rm \\
                         --network=none \\
                         --memory=2g \\
                         --cpus=1 \\
                         --security-opt no-new-privileges \\
                         --cap-drop ALL \\
                         -e PROJECT_ID=${PROJECT_ID} \\
                         -e AGENT_ID=${agentId} \\
                         -e USER_ID=${userId} \\
                         -e SESSION_ID=${sessionId} \\
                         -e MODE=BACKTEST \\
                         -e START_DATE=${startDate} \\
                         -e END_DATE=${endDate} \\
                         -e INITIAL_CASH=${initialCash} \\
                         -e SYMBOLS=${symbols.join(',')} \\
                         -v /workspace:/workspace \\
                         ${imageName} \\
                         > /workspace/output.json`
                    ],
                    id: 'run-backtest',
                },
                // Upload results
                {
                    name: 'gcr.io/cloud-builders/gsutil',
                    args: [
                        'cp',
                        '/workspace/output.json',
                        `gs://${PROJECT_ID}-backtest-results/${sessionId}/results.json`
                    ],
                    id: 'upload-results'
                }
            ],
            timeout: '1800s',
            options: {
                machineType: 'E2_STANDARD_2',
                diskSizeGb: 20,
                logging: 'CLOUD_LOGGING_ONLY'
            }
        };

        // Submit build
        const [operation] = await cloudbuild.createBuild({
            projectId: PROJECT_ID,
            build: buildConfig
        });

        const buildId = operation.name.split('/').pop();

        // Store session info
        await firestore.collection('backtestSessions').doc(sessionId).set({
            sessionId,
            agentId,
            userId,
            buildId,
            status: 'running',
            parameters: {
                startDate,
                endDate,
                initialCash,
                symbols
            },
            createdAt: new Date()
        });

        res.status(202).json({
            sessionId,
            buildId,
            status: 'submitted',
            message: 'Backtest started successfully'
        });

    } catch (error) {
        console.error('Error starting backtest:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get backtest results
app.get('/api/backtest/:sessionId/results', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.headers['x-user-id'];

        // Get session info
        const sessionDoc = await firestore.collection('backtestSessions').doc(sessionId).get();

        if (!sessionDoc.exists) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const sessionData = sessionDoc.data();

        // Verify ownership
        if (sessionData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get results from BigQuery or Storage
        const { Storage } = require('@google-cloud/storage');
        const storage = new Storage();
        const bucket = storage.bucket(`${PROJECT_ID}-backtest-results`);
        const file = bucket.file(`${sessionId}/results.json`);

        try {
            const [content] = await file.download();
            const results = JSON.parse(content.toString());

            res.json({
                ...sessionData,
                results,
                status: 'completed'
            });
        } catch (err) {
            // Results not ready yet
            res.json({
                ...sessionData,
                status: sessionData.status || 'running',
                message: 'Results not available yet'
            });
        }

    } catch (error) {
        console.error('Error getting results:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get backtest status
app.get('/api/backtest/:sessionId/status', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.headers['x-user-id'];

        const sessionDoc = await firestore.collection('backtestSessions').doc(sessionId).get();

        if (!sessionDoc.exists) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const sessionData = sessionDoc.data();

        if (sessionData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Check Cloud Build status if still running
        if (sessionData.buildId && sessionData.status === 'running') {
            const [build] = await cloudbuild.getBuild({
                projectId: PROJECT_ID,
                id: sessionData.buildId
            });

            const cloudBuildStatus = build.status;
            let status = 'running';

            if (cloudBuildStatus === 'SUCCESS') {
                status = 'completed';
            } else if (cloudBuildStatus === 'FAILURE' || cloudBuildStatus === 'TIMEOUT') {
                status = 'failed';
            }

            // Update status if changed
            if (status !== sessionData.status) {
                await firestore.collection('backtestSessions').doc(sessionId).update({
                    status,
                    updatedAt: new Date()
                });
            }

            res.json({
                sessionId,
                status,
                buildStatus: cloudBuildStatus
            });
        } else {
            res.json({
                sessionId,
                status: sessionData.status
            });
        }

    } catch (error) {
        console.error('Error getting status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Subscribe to backtest requests from Pub/Sub (for async processing)
async function subscribeToBacktestRequests() {
    const subscription = pubsub.subscription('backtest-requests-sub');

    subscription.on('message', async (message) => {
        try {
            const data = JSON.parse(message.data.toString());
            console.log('Received backtest request:', data);

            // Process backtest request
            // This allows other services to trigger backtests async

            message.ack();
        } catch (error) {
            console.error('Error processing message:', error);
            message.nack();
        }
    });

    console.log('Subscribed to backtest requests');
}

// Start subscription
subscribeToBacktestRequests().catch(console.error);

// Start server
app.listen(PORT, () => {
    console.log(`Backtest service listening on port ${PORT}`);
});