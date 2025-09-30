/**
 * Unified Authentication Middleware
 * Consolidates auth logic from all previous Cloud Functions
 */

const admin = require('firebase-admin');
const rateLimit = require('express-rate-limit');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT || process.env.PROJECT_ID
  });
}

/**
 * Authentication middleware
 * Supports both "Bearer <token>" and raw "<token>" formats for backward compatibility
 */
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing authorization header'
      });
    }

    // Support both "Bearer <token>" and raw "<token>" formats
    // The website sends raw tokens without "Bearer " prefix
    let idToken;
    if (authHeader.startsWith('Bearer ')) {
      idToken = authHeader.split('Bearer ')[1];
    } else {
      // Legacy format: raw token without "Bearer " prefix
      idToken = authHeader;
    }

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Add user context to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }
};

/**
 * Route-specific rate limiters
 */
const createRateLimiter = (maxRequests, windowMs = 60000, message) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    message: { error: 'Rate limit exceeded', message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.user?.uid || req.ip;
    }
  });
};

// Specific rate limiters for different endpoints
const rateLimiters = {
  // Agent operations
  submitAgent: createRateLimiter(10, 60000, 'Too many agent submissions per minute'),
  agentList: createRateLimiter(100, 60000, 'Too many agent list requests per minute'),
  agentCode: createRateLimiter(20, 60000, 'Too many agent code requests per minute'),
  agentUpdate: createRateLimiter(50, 60000, 'Too many agent update requests per minute'),
  agentDelete: createRateLimiter(10, 60000, 'Too many agent delete requests per minute'),

  // Backtesting
  runBacktest: createRateLimiter(5, 60000, 'Too many backtest requests per minute'),

  // Broker operations (consolidated from separate Cloud Functions)
  brokerOps: createRateLimiter(5, 60000, 'Too many broker operations per minute'),
  createAccount: createRateLimiter(1, 600000, 'Too many account creation requests per 10 minutes'),
  fundAccount: createRateLimiter(2, 300000, 'Too many account funding requests per 5 minutes'),

  // Paper trading
  paperTradingStart: createRateLimiter(3, 60000, 'Too many paper trading start requests per minute'),
  paperTradingStop: createRateLimiter(5, 60000, 'Too many paper trading stop requests per minute'),

  // FMEL analytics
  fmelQuery: createRateLimiter(100, 60000, 'Too many FMEL queries per minute'),
  fmelAnalytics: createRateLimiter(50, 60000, 'Too many FMEL analytics requests per minute'),
  fmelSearch: createRateLimiter(20, 60000, 'Too many FMEL search requests per minute')
};

/**
 * Error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error('API Error:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    user: req.user?.uid,
    timestamp: new Date().toISOString()
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(err.statusCode || 500).json({
    error: err.name || 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
    ...(isDevelopment && { stack: err.stack }),
    timestamp: new Date().toISOString()
  });
};

/**
 * Request logging middleware
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log({
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.headers['user-agent'],
      user: req.user?.uid,
      timestamp: new Date().toISOString()
    });
  });

  next();
};

module.exports = {
  authenticateUser,
  rateLimiters,
  errorHandler,
  requestLogger
};