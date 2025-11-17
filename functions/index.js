/**
 * Firebase Functions Entry Point
 * Minimal setup for agent submission and backtesting
 */

// Import the core functions
const { submitAgent } = require('./submitAgent');
const { updateAgentMetadata } = require('./updateAgentMetadata');
const { beginPaperTrading } = require('./beginPaperTrading');

// Export functions
exports.submitAgent = submitAgent;
exports.updateAgentMetadata = updateAgentMetadata;
exports.beginPaperTrading = beginPaperTrading;