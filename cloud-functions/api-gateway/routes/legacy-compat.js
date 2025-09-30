/**
 * Legacy Compatibility Router
 * Maps old Cloud Function endpoints to new unified API Gateway
 * This allows the existing website to work without modifications
 */

const express = require('express');
const router = express.Router();
const { authenticateUser, rateLimiters } = require('../middleware/auth');

/**
 * Legacy endpoint: /submitAgent
 * Maps to: /api/agents/submit
 */
router.post('/submitAgent', authenticateUser, rateLimiters.submitAgent, async (req, res, next) => {
    // Forward to new endpoint
    req.url = '/api/agents/submit';
    next();
});

/**
 * Legacy endpoint: /CreateAccount
 * Maps to: /api/broker/create-account
 */
router.post('/CreateAccount', authenticateUser, rateLimiters.createAccount, async (req, res, next) => {
    // Forward to new endpoint
    req.url = '/api/broker/create-account';
    next();
});

/**
 * Legacy endpoint: /FundAccount
 * Maps to: /api/broker/fund-account
 */
router.post('/FundAccount', authenticateUser, rateLimiters.fundAccount, async (req, res, next) => {
    // The website doesn't send amount, so add default
    if (!req.body.amount) {
        req.body.amount = 25000;
    }
    // Forward to new endpoint
    req.url = '/api/broker/fund-account';
    next();
});

/**
 * Legacy endpoint: /fund_alpaca_account
 * Maps to: /api/broker/fund-account
 */
router.post('/fund_alpaca_account', authenticateUser, rateLimiters.fundAccount, async (req, res, next) => {
    // The website doesn't send amount, so add default
    if (!req.body.amount) {
        req.body.amount = 25000;
    }
    // Forward to new endpoint
    req.url = '/api/broker/fund-account';
    next();
});

/**
 * Legacy endpoint: /BeginPaperTrading or /beginPaperTrading
 * Maps to: /api/paper-trading/start
 */
router.post(['/BeginPaperTrading', '/beginPaperTrading'], authenticateUser, rateLimiters.paperTradingStart, async (req, res, next) => {
    // Add default config if not provided
    if (!req.body.initialCash) {
        req.body.initialCash = 100000;
    }
    if (!req.body.riskLevel) {
        req.body.riskLevel = 'medium';
    }
    // Forward to new endpoint
    req.url = '/api/paper-trading/start';
    next();
});

/**
 * Legacy endpoint: /register-alpaca-account
 * Maps to: /api/broker/create-account
 */
router.post('/register-alpaca-account', authenticateUser, rateLimiters.createAccount, async (req, res, next) => {
    // Forward to new endpoint
    req.url = '/api/broker/create-account';
    next();
});

module.exports = router;