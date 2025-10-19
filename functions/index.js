/**
 * Firebase Functions Entry Point
 * Minimal setup for agent submission and backtesting
 */

// Import the two core functions
const { submitAgent } = require('./submitAgent');
const { updateAgentMetadata } = require('./updateAgentMetadata');

// Export functions
exports.submitAgent = submitAgent;
exports.updateAgentMetadata = updateAgentMetadata;