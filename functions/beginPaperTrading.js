/**
 * Begin Paper Trading Function
 * Starts paper trading session for an agent
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { verifyIdToken } = require('./authUtils');

// Initialize if not already done
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.database();

// Create Express app
const app = express();

// CORS Setup
app.use(cors({ origin: true }));

// Body parser for JSON
app.use(express.json());

/**
 * Begin Paper Trading Route
 * POST / with verifyIdToken middleware
 */
app.post('/', verifyIdToken, (req, res) => {
    const userId = req.body.decodedToken.uid;
    const { agentId } = req.body;

    if (!agentId) {
        return res.status(400).json({ error: 'Agent ID is required' });
    }

    // Verify agent ownership
    const agentRef = db.ref(`users/${userId}/agents/${agentId}`);

    return agentRef.once('value')
        .then(agentSnapshot => {
            if (!agentSnapshot.exists()) {
                return res.status(404).json({ error: 'Agent not found' });
            }

            const agentData = agentSnapshot.val();

            // Check if already trading
            if (agentData.paperTradingActive) {
                return res.json({
                    success: true,
                    message: 'Paper trading already active',
                    deploymentId: agentData.currentSessionId
                });
            }

            const sessionId = uuidv4();

            // Update agent status
            return agentRef.update({
                paperTradingActive: true,
                currentSessionId: sessionId,
                paperTradingStartedAt: new Date().toISOString()
            })
            .then(() => {
                // Record session
                return db.ref(`paperTradingSessions/${sessionId}`).set({
                    sessionId,
                    agentId,
                    userId,
                    status: 'starting',
                    createdAt: new Date().toISOString()
                });
            })
            .then(() => {
                // TODO: Deploy to Kubernetes cluster
                // In production, this would trigger actual deployment to GKE
                // For MVP, we just mark as started

                // Return response matching original Cloud Function format
                res.json({
                    success: true,
                    message: 'Paper trading started',
                    deploymentId: sessionId
                });
            });
        })
        .catch(error => {
            console.error('Error starting paper trading:', error);
            res.status(500).send({ error: 'Internal server error' });
        });
});

// Export as Firebase Function
exports.beginPaperTrading = functions.https.onRequest(app);