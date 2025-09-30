/**
 * Comprehensive Tests for Firebase Authentication Middleware
 * Tests all security features and edge cases for 2024 best practices
 */

const request = require('supertest');
const sinon = require('sinon');
const express = require('express');

// Mock Firebase Admin before requiring auth module
const mockAdmin = {
    auth: sinon.stub(),
    apps: [],
    initializeApp: sinon.stub(),
    credential: {
        applicationDefault: sinon.stub()
    }
};

// Mock Firebase Admin SDK
jest.doMock('firebase-admin', () => mockAdmin);

const {
    authenticateUser,
    optionalAuth,
    requirePermissions,
    rateLimit,
    validateOwnership,
    addUserContext,
    securityHeaders,
    secureCORS
} = require('../../cloud-functions/shared/auth');

describe('Firebase Authentication Middleware', () => {
    let app, mockVerifyIdToken;

    beforeEach(() => {
        // Create fresh Express app for each test
        app = express();
        app.use(express.json());

        // Reset all mocks
        sinon.restore();
        jest.clearAllMocks();

        // Mock Firebase auth methods
        mockVerifyIdToken = sinon.stub();
        mockAdmin.auth.returns({
            verifyIdToken: mockVerifyIdToken
        });

        // Default successful token verification
        mockVerifyIdToken.resolves({
            uid: 'test-user-123',
            email: 'test@example.com',
            email_verified: true,
            name: 'Test User',
            picture: 'https://example.com/avatar.jpg',
            customClaims: {
                permissions: ['user']
            }
        });
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('authenticateUser middleware', () => {
        beforeEach(() => {
            app.get('/protected', authenticateUser, (req, res) => {
                res.json({ user: req.user, message: 'Success' });
            });
        });

        test('should authenticate valid JWT token', async () => {
            const response = await request(app)
                .get('/protected')
                .set('Authorization', 'Bearer valid-token')
                .expect(200);

            expect(response.body.user).toEqual({
                uid: 'test-user-123',
                email: 'test@example.com',
                emailVerified: true,
                name: 'Test User',
                picture: 'https://example.com/avatar.jpg',
                customClaims: {
                    permissions: ['user']
                }
            });
            expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-token');
        });

        test('should reject request without Authorization header', async () => {
            const response = await request(app)
                .get('/protected')
                .expect(401);

            expect(response.body.error).toBe('Missing or invalid authorization header');
        });

        test('should reject request with invalid Authorization header format', async () => {
            const response = await request(app)
                .get('/protected')
                .set('Authorization', 'Invalid format')
                .expect(401);

            expect(response.body.error).toBe('Missing or invalid authorization header');
        });

        test('should reject request with empty token', async () => {
            const response = await request(app)
                .get('/protected')
                .set('Authorization', 'Bearer ')
                .expect(401);

            expect(response.body.error).toBe('Missing authentication token');
        });

        test('should handle expired token error', async () => {
            mockVerifyIdToken.rejects({
                code: 'auth/id-token-expired',
                message: 'Token expired'
            });

            const response = await request(app)
                .get('/protected')
                .set('Authorization', 'Bearer expired-token')
                .expect(401);

            expect(response.body.error).toBe('Authentication token expired');
        });

        test('should handle revoked token error', async () => {
            mockVerifyIdToken.rejects({
                code: 'auth/id-token-revoked',
                message: 'Token revoked'
            });

            const response = await request(app)
                .get('/protected')
                .set('Authorization', 'Bearer revoked-token')
                .expect(401);

            expect(response.body.error).toBe('Authentication token revoked');
        });

        test('should handle invalid token error', async () => {
            mockVerifyIdToken.rejects({
                code: 'auth/invalid-id-token',
                message: 'Invalid token'
            });

            const response = await request(app)
                .get('/protected')
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);

            expect(response.body.error).toBe('Invalid authentication token');
        });

        test('should handle generic authentication error', async () => {
            mockVerifyIdToken.rejects(new Error('Network error'));

            const response = await request(app)
                .get('/protected')
                .set('Authorization', 'Bearer network-error-token')
                .expect(401);

            expect(response.body.error).toBe('Authentication failed');
        });
    });

    describe('optionalAuth middleware', () => {
        beforeEach(() => {
            app.get('/optional', optionalAuth, (req, res) => {
                res.json({
                    user: req.user,
                    authenticated: req.user !== null,
                    message: 'Success'
                });
            });
        });

        test('should allow authenticated requests', async () => {
            const response = await request(app)
                .get('/optional')
                .set('Authorization', 'Bearer valid-token')
                .expect(200);

            expect(response.body.authenticated).toBe(true);
            expect(response.body.user.uid).toBe('test-user-123');
        });

        test('should allow unauthenticated requests without header', async () => {
            const response = await request(app)
                .get('/optional')
                .expect(200);

            expect(response.body.authenticated).toBe(false);
            expect(response.body.user).toBeNull();
        });

        test('should allow unauthenticated requests with invalid token', async () => {
            mockVerifyIdToken.rejects(new Error('Invalid token'));

            const response = await request(app)
                .get('/optional')
                .set('Authorization', 'Bearer invalid-token')
                .expect(200);

            expect(response.body.authenticated).toBe(false);
            expect(response.body.user).toBeNull();
        });
    });

    describe('requirePermissions middleware', () => {
        beforeEach(() => {
            app.get('/admin', authenticateUser, requirePermissions(['admin']), (req, res) => {
                res.json({ message: 'Admin access granted' });
            });

            app.get('/user', authenticateUser, requirePermissions(['user', 'admin']), (req, res) => {
                res.json({ message: 'User access granted' });
            });
        });

        test('should allow access with correct permissions', async () => {
            const response = await request(app)
                .get('/user')
                .set('Authorization', 'Bearer valid-token')
                .expect(200);

            expect(response.body.message).toBe('User access granted');
        });

        test('should allow admin access to any resource', async () => {
            mockVerifyIdToken.resolves({
                uid: 'admin-user',
                email: 'admin@example.com',
                email_verified: true,
                customClaims: {
                    permissions: ['admin']
                }
            });

            const response = await request(app)
                .get('/admin')
                .set('Authorization', 'Bearer admin-token')
                .expect(200);

            expect(response.body.message).toBe('Admin access granted');
        });

        test('should deny access without sufficient permissions', async () => {
            const response = await request(app)
                .get('/admin')
                .set('Authorization', 'Bearer valid-token')
                .expect(403);

            expect(response.body.error).toBe('Insufficient permissions');
            expect(response.body.required).toEqual(['admin']);
            expect(response.body.userPermissions).toEqual(['user']);
        });

        test('should deny access for unauthenticated users', async () => {
            const testApp = express();
            testApp.get('/test', requirePermissions(['user']), (req, res) => {
                res.json({ message: 'Success' });
            });

            const response = await request(testApp)
                .get('/test')
                .expect(401);

            expect(response.body.error).toBe('Authentication required');
        });
    });

    describe('rateLimit middleware', () => {
        let rateLimitedApp;

        beforeEach(() => {
            rateLimitedApp = express();
            rateLimitedApp.use(express.json());
            rateLimitedApp.use(optionalAuth);
            rateLimitedApp.use(rateLimit(3, 1000)); // 3 requests per 1 second
            rateLimitedApp.get('/limited', (req, res) => {
                res.json({ message: 'Success' });
            });
        });

        test('should allow requests within rate limit', async () => {
            for (let i = 0; i < 3; i++) {
                await request(rateLimitedApp)
                    .get('/limited')
                    .set('Authorization', 'Bearer valid-token')
                    .expect(200);
            }
        });

        test('should block requests exceeding rate limit', async () => {
            // Make 3 successful requests
            for (let i = 0; i < 3; i++) {
                await request(rateLimitedApp)
                    .get('/limited')
                    .set('Authorization', 'Bearer valid-token')
                    .expect(200);
            }

            // 4th request should be blocked
            const response = await request(rateLimitedApp)
                .get('/limited')
                .set('Authorization', 'Bearer valid-token')
                .expect(429);

            expect(response.body.error).toBe('Rate limit exceeded');
            expect(response.body.retryAfter).toBeGreaterThan(0);
        });

        test('should rate limit by IP for unauthenticated users', async () => {
            for (let i = 0; i < 3; i++) {
                await request(rateLimitedApp)
                    .get('/limited')
                    .expect(200);
            }

            const response = await request(rateLimitedApp)
                .get('/limited')
                .expect(429);

            expect(response.body.error).toBe('Rate limit exceeded');
        });
    });

    describe('validateOwnership middleware', () => {
        beforeEach(() => {
            app.get('/user/:userId', authenticateUser, validateOwnership, (req, res) => {
                res.json({ message: 'Access granted', userId: req.params.userId });
            });

            app.post('/data', authenticateUser, validateOwnership, (req, res) => {
                res.json({ message: 'Data updated', userId: req.body.userId });
            });
        });

        test('should allow access to own resources', async () => {
            const response = await request(app)
                .get('/user/test-user-123')
                .set('Authorization', 'Bearer valid-token')
                .expect(200);

            expect(response.body.message).toBe('Access granted');
        });

        test('should deny access to other users resources', async () => {
            const response = await request(app)
                .get('/user/other-user-456')
                .set('Authorization', 'Bearer valid-token')
                .expect(403);

            expect(response.body.error).toBe('Access denied: You can only access your own resources');
        });

        test('should allow admin access to any resource', async () => {
            mockVerifyIdToken.resolves({
                uid: 'admin-user',
                email: 'admin@example.com',
                email_verified: true,
                customClaims: {
                    permissions: ['admin']
                }
            });

            const response = await request(app)
                .get('/user/other-user-456')
                .set('Authorization', 'Bearer admin-token')
                .expect(200);

            expect(response.body.message).toBe('Access granted');
        });

        test('should handle body userId validation', async () => {
            const response = await request(app)
                .post('/data')
                .set('Authorization', 'Bearer valid-token')
                .send({ userId: 'other-user-456', data: 'test' })
                .expect(403);

            expect(response.body.error).toBe('Access denied: You can only access your own resources');
        });
    });

    describe('addUserContext middleware', () => {
        beforeEach(() => {
            app.post('/data', authenticateUser, addUserContext, (req, res) => {
                res.json({ userId: req.body.userId, message: 'Success' });
            });
        });

        test('should add user ID to request body when not provided', async () => {
            const response = await request(app)
                .post('/data')
                .set('Authorization', 'Bearer valid-token')
                .send({ data: 'test' })
                .expect(200);

            expect(response.body.userId).toBe('test-user-123');
        });

        test('should not override existing userId in request body', async () => {
            const response = await request(app)
                .post('/data')
                .set('Authorization', 'Bearer valid-token')
                .send({ userId: 'existing-user', data: 'test' })
                .expect(200);

            expect(response.body.userId).toBe('existing-user');
        });
    });

    describe('securityHeaders middleware', () => {
        beforeEach(() => {
            app.use(securityHeaders);
            app.get('/secure', (req, res) => {
                res.json({ message: 'Secure response' });
            });
        });

        test('should add all required security headers', async () => {
            const response = await request(app)
                .get('/secure')
                .expect(200);

            expect(response.headers['x-content-type-options']).toBe('nosniff');
            expect(response.headers['x-frame-options']).toBe('DENY');
            expect(response.headers['x-xss-protection']).toBe('1; mode=block');
            expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
            expect(response.headers['content-security-policy']).toContain("default-src 'self'");
            expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains; preload');
            expect(response.headers['permissions-policy']).toBe('geolocation=(), microphone=(), camera=()');
        });
    });

    describe('secureCORS middleware', () => {
        test('should handle CORS for allowed origins', async () => {
            const corsApp = express();
            corsApp.use(secureCORS(['https://spookylabs.com']));
            corsApp.get('/test', (req, res) => {
                res.json({ message: 'CORS test' });
            });

            const response = await request(corsApp)
                .get('/test')
                .set('Origin', 'https://spookylabs.com')
                .expect(200);

            expect(response.headers['access-control-allow-origin']).toBe('https://spookylabs.com');
            expect(response.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
            expect(response.headers['access-control-allow-headers']).toBe('Content-Type, Authorization, X-Requested-With');
            expect(response.headers['access-control-allow-credentials']).toBe('true');
        });

        test('should handle OPTIONS preflight requests', async () => {
            const corsApp = express();
            corsApp.use(secureCORS(['*']));
            corsApp.get('/test', (req, res) => {
                res.json({ message: 'CORS test' });
            });

            const response = await request(corsApp)
                .options('/test')
                .expect(204);

            expect(response.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
        });

        test('should allow all origins when wildcard is used', async () => {
            const corsApp = express();
            corsApp.use(secureCORS(['*']));
            corsApp.get('/test', (req, res) => {
                res.json({ message: 'CORS test' });
            });

            const response = await request(corsApp)
                .get('/test')
                .set('Origin', 'https://example.com')
                .expect(200);

            expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
        });
    });
});