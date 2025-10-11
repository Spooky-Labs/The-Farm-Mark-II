/**
 * Authentication Utilities
 * Express middleware for Firebase Functions
 */

const admin = require('firebase-admin');

// Initialize if not already done
if (!admin.apps.length) {
    admin.initializeApp();
}

/**
 * Express middleware to verify Firebase ID Token
 * Extracts Bearer token, verifies it, and adds decoded token to request
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const verifyIdToken = function(req, res, next) {
    // Check for Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Missing or invalid authorization header'
        });
    }

    // Extract token from "Bearer TOKEN" format
    const token = authHeader.split('Bearer ')[1];

    // Verify the token with Firebase Auth
    // When FIREBASE_AUTH_EMULATOR_HOST is set, this automatically uses the emulator
    return admin.auth()
        .verifyIdToken(token)
        .then(function(decodedToken) {
            // Add decoded token to request body for downstream use
            req.body = req.body || {};
            req.body.decodedToken = decodedToken;

            // Clear authorization header to prevent token leakage in logs
            req.headers.authorization = undefined;

            console.log('ID Token verified for user:', decodedToken.uid);

            // Call next middleware
            next();
        })
        .catch(function(error) {
            // Firebase auth errors propagate with useful information
            // like 'auth/id-token-expired', 'auth/argument-error', etc.
            console.error('Authentication error:', error.code, error.message);
            res.status(401).json({
                error: 'Unauthorized',
                code: error.code,
                message: error.message
            });
        });
};

module.exports = {
    verifyIdToken
};