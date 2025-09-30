/**
 * Unified API Gateway for Spooky Labs
 * Consolidates all API endpoints into a single service
 */

const functions = require('@google-cloud/functions-framework');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Route handlers
const agentRoutes = require('./routes/agents');
const backtestRoutes = require('./routes/backtest');
const brokerRoutes = require('./routes/broker');  // NEW: Consolidated broker operations
const paperTradingRoutes = require('./routes/paper-trading');
const leaderboardRoutes = require('./routes/leaderboard-redis');  // Redis-enabled leaderboard
const fmelRoutes = require('./routes/fmel');
const legacyCompatRoutes = require('./routes/legacy-compat');  // Legacy endpoint compatibility

// Middleware
const { authenticateUser, errorHandler } = require('./middleware/auth');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Legacy compatibility routes (must come first to intercept old endpoints)
// These routes map old Cloud Function endpoints to new API structure
app.use('/', legacyCompatRoutes);

// API routes with authentication
app.use('/api/agents', authenticateUser, agentRoutes);
app.use('/api/backtest', authenticateUser, backtestRoutes);
app.use('/api/broker', authenticateUser, brokerRoutes);  // NEW: Alpaca account management
app.use('/api/paper-trading', authenticateUser, paperTradingRoutes);
app.use('/api/fmel', authenticateUser, fmelRoutes);

// Public routes (no auth required)
app.use('/api/leaderboard', leaderboardRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    availableRoutes: [
      '/health',
      '/api/agents',
      '/api/backtest',
      '/api/broker',
      '/api/paper-trading',
      '/api/leaderboard',
      '/api/fmel'
    ]
  });
});

// Error handling middleware
app.use(errorHandler);

// Register the Express app with Cloud Functions
functions.http('api-gateway', app);

module.exports = app;