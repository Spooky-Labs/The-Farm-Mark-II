/**
 * Stop Paper Trading Function
 * Stops an active paper trading session
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { verifyIdToken, handleOptions, setCorsHeaders } = require('./authUtils');

// Initialize if not already done
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.database();

/**
 * Stop Paper Trading - Stop trading session
 */
exports.stopPaperTrading = functions.https.onRequest((req, res) => {
    // Set CORS headers
    setCorsHeaders(res);

    // Handle OPTIONS preflight
    if (handleOptions(req, res)) {
        return;
    }

    // Verify token and stop paper trading
    verifyIdToken(req)
        .then(verifiedReq => {
            const userId = verifiedReq.body.decodedToken.uid;
            const { agentId } = verifiedReq.body;

            if (!agentId) {
                res.status(400).json({ error: 'Agent ID is required' });
                return Promise.reject('Missing agentId');
            }

            // Verify agent ownership
            const agentRef = db.ref(`users/${userId}/agents/${agentId}`);

            return agentRef.once('value')
                .then(agentSnapshot => {
                    if (!agentSnapshot.exists()) {
                        res.status(404).json({ error: 'Agent not found' });
                        return Promise.reject('Agent not found');
                    }

                    const agentData = agentSnapshot.val();

                    // Check if trading is active
                    if (!agentData.paperTradingActive) {
                        res.json({
                            success: true,
                            message: 'Paper trading not active'
                        });
                        return Promise.reject('Not active');
                    }

                    // Get session ID before clearing
                    const sessionId = agentData.currentSessionId;

                    // Update agent status
                    return agentRef.update({
                        paperTradingActive: false,
                        currentSessionId: null,
                        lastSessionId: sessionId,
                        lastStoppedAt: new Date().toISOString()
                    })
                    .then(() => {
                        // Update session status if exists
                        if (sessionId) {
                            return db.ref(`paperTradingSessions/${sessionId}`).update({
                                status: 'stopped',
                                stoppedAt: new Date().toISOString()
                            });
                        }
                        return Promise.resolve();
                    })
                    .then(() => {
                        // TODO: Delete Kubernetes deployment
                        // In production, this would trigger actual cleanup in GKE
                        // For MVP, we just mark as stopped

                        // Return response matching original Cloud Function format
                        res.json({
                            success: true,
                            message: 'Paper trading stopped'
                        });
                    });
                });
        })
        .catch(error => {
            // Handle Firebase auth errors (codes like 'auth/id-token-expired')
            if (error.code && error.code.startsWith('auth/')) {
                console.error('Authentication error:', error.code, error.message);
                res.status(401).json({
                    error: 'Unauthorized',
                    code: error.code,
                    message: error.message
                });
                return;
            }

            // Don't log validation rejections
            if (typeof error === 'string') {
                return;
            }

            console.error('Error stopping paper trading:', error);
            res.status(500).json({ error: 'Internal server error' });
        });
});