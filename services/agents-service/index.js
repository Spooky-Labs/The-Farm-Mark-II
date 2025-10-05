/**
 * Agents Service - Cloud Run
 * Handles all agent-related operations
 */

const express = require('express');
const { Storage } = require('@google-cloud/storage');
const { Firestore } = require('@google-cloud/firestore');
const { PubSub } = require('@google-cloud/pubsub');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.PROJECT_ID;

if (!PROJECT_ID) {
    console.error('PROJECT_ID environment variable is required');
    process.exit(1);
}

// Initialize clients
const storage = new Storage();
const firestore = new Firestore();
const pubsub = new PubSub();

const STORAGE_BUCKET = `${PROJECT_ID}-agent-code`;

// Initialize Firebase Admin
if (!admin.apps?.length) {
    admin.initializeApp();
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'agents-service',
        version: '1.0.0'
    });
});

// Submit new agent
app.post('/api/agents/submit', async (req, res) => {
    try {
        // Note: Authentication is handled by API Gateway
        const userId = req.headers['x-user-id']; // Injected by API Gateway
        const { agentName, description, tags, agentCode } = req.body;

        if (!agentName || !agentCode) {
            return res.status(400).json({
                error: 'Agent name and code are required'
            });
        }

        // Basic code validation
        if (agentCode.length < 100) {
            return res.status(400).json({
                error: 'Agent code appears to be too short to be valid'
            });
        }

        // Check for required strategy class
        if (!agentCode.includes('class') || !agentCode.includes('def')) {
            return res.status(400).json({
                error: 'Agent code must contain a valid Python strategy class'
            });
        }

        const agentId = uuidv4();
        const codeHash = crypto.createHash('sha256').update(agentCode).digest('hex');

        // Check for duplicate
        const existing = await firestore
            .collection('agents')
            .where('userId', '==', userId)
            .where('codeHash', '==', codeHash)
            .limit(1)
            .get();

        if (!existing.empty) {
            return res.status(409).json({
                error: 'Duplicate code detected',
                existingAgentId: existing.docs[0].id
            });
        }

        // Store code in Cloud Storage
        const bucket = storage.bucket(STORAGE_BUCKET);
        const file = bucket.file(`agents/${userId}/${agentId}/strategy.py`);

        await file.save(agentCode, {
            metadata: {
                contentType: 'text/plain',
                metadata: {
                    agentId,
                    userId,
                    uploadedAt: new Date().toISOString()
                }
            }
        });

        // Store metadata in Firestore
        const agentDoc = {
            agentId,
            agentName,
            description: description || '',
            tags: tags ? tags.split(',').map(t => t.trim()) : [],
            userId,
            codeHash,
            storagePath: `agents/${userId}/${agentId}/strategy.py`,
            createdAt: new Date(),
            status: 'active',
            backtestCount: 0,
            paperTradingActive: false
        };

        await firestore.collection('agents').doc(agentId).set(agentDoc);

        // Trigger automatic backtest via Pub/Sub
        await triggerBacktest(agentId, userId);

        res.status(201).json({
            success: true,
            agentId,
            message: 'Agent submitted successfully'
        });

    } catch (error) {
        console.error('Error submitting agent:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// List agents
app.get('/api/agents/list', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { page = 1, limit = 20, status } = req.query;

        let query = firestore
            .collection('agents')
            .where('userId', '==', userId);

        if (status) {
            query = query.where('status', '==', status);
        }

        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit))
            .offset((parseInt(page) - 1) * parseInt(limit))
            .get();

        const agents = snapshot.docs.map(doc => ({
            agentId: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt.toDate().toISOString()
        }));

        res.json({
            agents,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: snapshot.size
            }
        });

    } catch (error) {
        console.error('Error listing agents:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get agent details
app.get('/api/agents/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const userId = req.headers['x-user-id'];

        const doc = await firestore.collection('agents').doc(agentId).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const data = doc.data();

        // Check ownership
        if (data.userId !== userId && data.visibility !== 'public') {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({
            agentId,
            ...data,
            createdAt: data.createdAt.toDate().toISOString()
        });

    } catch (error) {
        console.error('Error getting agent:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete agent
app.delete('/api/agents/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const userId = req.headers['x-user-id'];

        const doc = await firestore.collection('agents').doc(agentId).get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const data = doc.data();

        if (data.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (data.paperTradingActive) {
            return res.status(400).json({
                error: 'Cannot delete agent while paper trading is active'
            });
        }

        // Soft delete
        await firestore.collection('agents').doc(agentId).update({
            status: 'deleted',
            deletedAt: new Date()
        });

        res.json({
            success: true,
            message: 'Agent deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting agent:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Helper function to trigger backtest
async function triggerBacktest(agentId, userId) {
    try {
        const message = {
            agentId,
            userId,
            timestamp: new Date().toISOString(),
            type: 'initial_backtest'
        };

        const messageId = await pubsub
            .topic('backtest-requests')
            .publishMessage({ json: message });

        console.log(`Published backtest request for agent ${agentId}, message ID: ${messageId}`);
        return messageId;
    } catch (error) {
        console.error('Error publishing backtest request:', error);
        // Don't fail the agent submission if backtest trigger fails
        // The user can manually trigger a backtest later
    }
}

// Start server
app.listen(PORT, () => {
    console.log(`Agents service listening on port ${PORT}`);
});