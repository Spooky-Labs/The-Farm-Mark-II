/**
 * Firebase Functions Entry Point
 * Imports and exports all Cloud Functions
 */

// Import JavaScript functions
const { submitAgent } = require('./submitAgent');
const { beginPaperTrading } = require('./beginPaperTrading');
const { stopPaperTrading } = require('./stopPaperTrading');
const { getLeaderboard } = require('./getLeaderboard');
const { updateAgentMetadata } = require('./updateAgentMetadata');

// Export all JavaScript functions
exports.submitAgent = submitAgent;
exports.beginPaperTrading = beginPaperTrading;
exports.stopPaperTrading = stopPaperTrading;
exports.getLeaderboard = getLeaderboard;
exports.updateAgentMetadata = updateAgentMetadata;

// Note: Python functions (createAccount, fundAccount) are in main.py
// Firebase will automatically detect and deploy them

// Include mock functions ONLY when running in emulator
// These replace Python functions for local testing
if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log('Running in emulator mode - loading Python function mocks');
    const { createAccountMock, fundAccountMock } = require('./localMocks');
    exports.createAccountMock = createAccountMock;
    exports.fundAccountMock = fundAccountMock;
}