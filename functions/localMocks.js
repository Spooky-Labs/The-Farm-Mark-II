/**
 * Local Mock Functions for Python Endpoints
 * These are JavaScript mocks of the Python functions for local testing only
 * DO NOT DEPLOY THESE TO PRODUCTION
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
 * Mock Create Account - Simulates Alpaca account creation
 * Replaces the Python createAccount function for local testing
 */
exports.createAccountMock = functions.https.onRequest((req, res) => {
    // Set CORS headers
    setCorsHeaders(res);

    // Handle OPTIONS preflight
    if (handleOptions(req, res)) {
        return;
    }

    // Verify token and create mock account
    verifyIdToken(req)
        .then(verifiedReq => {
            const userId = verifiedReq.body.decodedToken.uid;
            const { agentId } = verifiedReq.body;

            if (!agentId) {
                res.status(400).json({ error: 'Agent ID is required' });
                return Promise.reject('Missing agentId');
            }

            // Generate mock account ID
            const mockAccountId = `MOCK_ALPACA_${Date.now()}`;

            // Store in database
            return db.ref(`users/${userId}/accounts/${agentId}`).set({
                accountId: mockAccountId,
                created: new Date().toISOString(),
                funded: false,
                balance: 0
            })
            .then(() => {
                res.json({
                    success: true,
                    accountId: mockAccountId,
                    message: 'Mock account created for local testing',
                    note: 'This is a mock response - Python function not available in emulator'
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

            console.error('Mock create account error:', error);
            res.status(500).json({ error: 'Mock creation failed' });
        });
});

/**
 * Mock Fund Account - Simulates funding an Alpaca account
 * Replaces the Python fundAccount function for local testing
 */
exports.fundAccountMock = functions.https.onRequest((req, res) => {
    // Set CORS headers
    setCorsHeaders(res);

    // Handle OPTIONS preflight
    if (handleOptions(req, res)) {
        return;
    }

    // Verify token and fund mock account
    verifyIdToken(req)
        .then(verifiedReq => {
            const userId = verifiedReq.body.decodedToken.uid;
            const { agentId, amount = 100000 } = verifiedReq.body;

            if (!agentId) {
                res.status(400).json({ error: 'Agent ID is required' });
                return Promise.reject('Missing agentId');
            }

            // Reference to account in database
            const accountRef = db.ref(`users/${userId}/accounts/${agentId}`);

            return accountRef.once('value')
                .then(snapshot => {
                    if (!snapshot.exists()) {
                        // Create mock account if doesn't exist
                        return accountRef.set({
                            accountId: `MOCK_ALPACA_${Date.now()}`,
                            created: new Date().toISOString(),
                            funded: true,
                            balance: amount,
                            fundedAt: new Date().toISOString()
                        });
                    } else {
                        // Update existing mock account
                        return accountRef.update({
                            funded: true,
                            balance: amount,
                            fundedAt: new Date().toISOString()
                        });
                    }
                })
                .then(() => {
                    res.json({
                        success: true,
                        balance: amount,
                        message: 'Mock account funded for local testing',
                        note: 'This is a mock response - Python function not available in emulator'
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

            console.error('Mock fund account error:', error);
            res.status(500).json({ error: 'Mock funding failed' });
        });
});