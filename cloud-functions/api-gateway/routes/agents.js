/**
 * Agent Management Routes
 * Consolidates submit-agent and agent-management functionality
 */

const express = require('express');
const { Storage } = require('@google-cloud/storage');
const { Firestore } = require('@google-cloud/firestore');
const { CloudBuildClient } = require('@google-cloud/cloudbuild');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const multipartFileUpload = require('../middleware/multipart');
const { rateLimiters } = require('../middleware/auth');

const router = express.Router();

// Initialize clients
const storage = new Storage();
const firestore = new Firestore();
const cloudbuild = new CloudBuildClient();

const PROJECT_ID = process.env.PROJECT_ID;
const STORAGE_BUCKET = `${PROJECT_ID}-agent-code`;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 1048576; // 1MB

// Blocked imports for security
const BLOCKED_IMPORTS = new Set([
    'os', 'subprocess', 'socket', 'requests', 'urllib', 'http',
    'sys', 'importlib', 'exec', 'eval', '__import__',
    'open', 'file', 'input', 'raw_input'
]);

/**
 * Submit a new agent
 */
router.post('/submit',
    rateLimiters.submitAgent,
    multipartFileUpload({ fileSize: 1048576 }), // 1MB limit
    async (req, res, next) => {
    try {
        const { agentName, description, tags } = req.body;
        const userId = req.user.uid;

        // Handle both file upload and direct code submission
        let agentCode;
        if (req.files && req.files.file) {
            // File uploaded
            agentCode = req.files.file.buffer.toString('utf8');
        } else if (req.body.agentCode) {
            // Direct code submission
            agentCode = req.body.agentCode;
        } else {
            return res.status(400).json({ error: 'Agent code is required (file upload or agentCode field)' });
        }

        if (!agentName) {
            return res.status(400).json({ error: 'Agent name is required' });
        }

        if (agentCode.length > MAX_FILE_SIZE) {
            return res.status(400).json({
                error: `Agent code too large. Max size: ${MAX_FILE_SIZE} bytes`
            });
        }

        // Validate agent code
        const validationResult = validateAgentCode(agentCode);
        if (!validationResult.valid) {
            return res.status(400).json({
                error: `Code validation failed: ${validationResult.error}`
            });
        }

        // Generate agent ID
        const agentId = uuidv4();

        // Create code hash for deduplication
        const codeHash = crypto.createHash('sha256').update(agentCode).digest('hex');

        // Check for duplicate code
        const existingAgent = await firestore
            .collection('agents')
            .where('userId', '==', userId)
            .where('codeHash', '==', codeHash)
            .limit(1)
            .get();

        if (!existingAgent.empty) {
            return res.status(409).json({
                error: 'Duplicate code detected',
                existingAgentId: existingAgent.docs[0].id
            });
        }

        // Store code in Cloud Storage (matching original path structure)
        const bucket = storage.bucket(STORAGE_BUCKET);
        const filename = req.files?.file?.originalname || 'strategy.py';
        const file = bucket.file(`agents/${userId}/${agentId}/${filename}`);

        await file.save(agentCode, {
            metadata: {
                contentType: 'text/plain',
                metadata: {
                    agentId,
                    userId,
                    originalFilename: filename,
                    uploadedAt: new Date().toISOString()
                }
            }
        });

        // Store metadata in Firestore
        const agentDoc = {
            agentId,
            agentName,
            description: description || '',
            tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
            userId,
            codeHash,
            storagePath: `agents/${userId}/${agentId}/${filename}`,
            createdAt: new Date(),
            status: 'active',
            validationResult,
            backtestCount: 0,
            paperTradingActive: false,
            visibility: 'private'
        };

        await firestore.collection('agents').doc(agentId).set(agentDoc);

        // Also write to Firebase Realtime Database for website compatibility
        const rtdb = admin.database();
        await rtdb.ref(`creators/${userId}/agents/${agentId}`).set({
            originalName: agentName,
            status: 'active',
            timeCreated: Date.now(),
            numberOfFiles: 1,
            agentId: agentId,
            description: description || '',
            tags: tags || ''
        });

        // Trigger automatic backtesting
        try {
            await triggerAutomaticBacktest(agentId, userId, agentName);
            console.log(`Automatic backtest triggered for agent: ${agentId}`);
        } catch (backtestError) {
            console.warn(`Failed to trigger automatic backtest: ${backtestError.message}`);
            // Update agent status to indicate backtest failed to start
            await firestore.collection('agents').doc(agentId).update({
                status: 'backtest_failed',
                backtestError: backtestError.message,
                updatedAt: new Date()
            });
        }

        // Log successful submission
        console.log(`Agent submitted successfully: ${agentId} by user ${userId}`);

        res.status(201).json({
            success: true,
            agentId,
            numberOfFiles: 1,  // Website expects this field
            message: 'Agent submitted successfully',
            validation: validationResult,
            backtestTriggered: true,
            timestamp: Date.now()  // Website may expect this
        });

    } catch (error) {
        next(error);
    }
});

/**
 * List user's agents
 */
router.get('/list', rateLimiters.agentList, async (req, res, next) => {
    try {
        const userId = req.user.uid;
        const { page = 1, limit = 20, status, tag } = req.query;

        let query = firestore
            .collection('agents')
            .where('userId', '==', userId);

        if (status) {
            query = query.where('status', '==', status);
        }

        if (tag) {
            query = query.where('tags', 'array-contains', tag);
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
        next(error);
    }
});

/**
 * Get agent details
 */
router.get('/:agentId', async (req, res, next) => {
    try {
        const { agentId } = req.params;
        const userId = req.user.uid;

        const agentDoc = await firestore.collection('agents').doc(agentId).get();

        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();

        // Check ownership or public visibility
        if (agentData.userId !== userId && agentData.visibility !== 'public') {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({
            agentId,
            ...agentData,
            createdAt: agentData.createdAt.toDate().toISOString()
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Get agent source code
 */
router.get('/:agentId/code', rateLimiters.agentCode, async (req, res, next) => {
    try {
        const { agentId } = req.params;
        const userId = req.user.uid;

        // Verify ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();

        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();

        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get code from storage
        const bucket = storage.bucket(STORAGE_BUCKET);
        const file = bucket.file(agentData.storagePath);

        const [exists] = await file.exists();
        if (!exists) {
            return res.status(404).json({ error: 'Agent code not found in storage' });
        }

        const [content] = await file.download();

        res.json({
            agentId,
            code: content.toString('utf8'),
            lastModified: agentData.createdAt.toDate().toISOString()
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Update agent metadata
 */
router.patch('/:agentId', rateLimiters.agentUpdate, async (req, res, next) => {
    try {
        const { agentId } = req.params;
        const userId = req.user.uid;
        const { agentName, description, tags, visibility } = req.body;

        // Verify ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();

        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();

        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Build update object
        const updates = {
            updatedAt: new Date()
        };

        if (agentName) updates.agentName = agentName;
        if (description !== undefined) updates.description = description;
        if (tags) updates.tags = tags.split(',').map(tag => tag.trim());
        if (visibility && ['public', 'private'].includes(visibility)) {
            updates.visibility = visibility;
        }

        await firestore.collection('agents').doc(agentId).update(updates);

        res.json({
            success: true,
            message: 'Agent updated successfully',
            agentId
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Delete agent
 */
router.delete('/:agentId', rateLimiters.agentDelete, async (req, res, next) => {
    try {
        const { agentId } = req.params;
        const userId = req.user.uid;

        // Verify ownership
        const agentDoc = await firestore.collection('agents').doc(agentId).get();

        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();

        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Check if agent is currently paper trading
        if (agentData.paperTradingActive) {
            return res.status(400).json({
                error: 'Cannot delete agent while paper trading is active'
            });
        }

        // Delete from storage
        const bucket = storage.bucket(STORAGE_BUCKET);
        const file = bucket.file(agentData.storagePath);

        try {
            await file.delete();
        } catch (storageError) {
            console.warn(`Failed to delete agent code from storage: ${storageError.message}`);
        }

        // Mark as deleted in Firestore (soft delete)
        await firestore.collection('agents').doc(agentId).update({
            status: 'deleted',
            deletedAt: new Date()
        });

        res.json({
            success: true,
            message: 'Agent deleted successfully',
            agentId
        });

    } catch (error) {
        next(error);
    }
});


/**
 * Trigger automatic backtesting for newly submitted agent
 * Based on original updateAgentMetadata Cloud Build integration
 */
async function triggerAutomaticBacktest(agentId, userId, agentName) {
    const projectId = PROJECT_ID;
    const region = process.env.REGION || 'us-central1';
    const imageName = `${region}-docker.pkg.dev/${projectId}/spooky-labs/backtest-runner:${agentId}`;
    const sourceLocation = `gs://${projectId}-agent-code/agents/${userId}/${agentId}`;
    const resultsPath = `/creators/${userId}/agents/${agentId}/backtest`;

    // Update agent status to indicate backtest is starting
    await firestore.collection('agents').doc(agentId).update({
        status: 'backtesting',
        backtestStartedAt: new Date(),
        updatedAt: new Date()
    });

    // Create Cloud Build configuration matching Course-1 pattern
    const buildConfig = {
        steps: [
            // Step 1: Pull from Git Repo (Course-1)
            {
                name: 'gcr.io/cloud-builders/git',
                args: ['clone', 'https://github.com/Spooky-Labs/Course-1.git'],
                id: 'clone-course-1',
                entrypoint: 'git',
            },
            // Step 2: Move Dockerfile to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/Dockerfile /workspace'],
                id: 'move-dockerfile',
                entrypoint: 'bash',
            },
            // Step 3: Move requirements.txt to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/requirements.txt /workspace'],
                id: 'move-requirements',
                entrypoint: 'bash',
            },
            // Step 4: Move runner.py to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/runner.py /workspace'],
                id: 'move-runner',
                entrypoint: 'bash',
            },
            // Step 5: Move symbols.txt to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/symbols.txt /workspace'],
                id: 'move-symbols',
                entrypoint: 'bash',
            },
            // Step 6: Create the /workspace/data directory
            {
                name: 'ubuntu',
                args: ['-c', 'mkdir -p /workspace/data'],
                id: 'create-data-dir',
                entrypoint: 'bash',
            },
            // Step 7: Create dedicated output directory
            {
                name: 'ubuntu',
                entrypoint: 'mkdir',
                args: ['-p', '/workspace/output'],
                id: 'create-output-dir'
            },
            // Step 8: Move data to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/data/* /workspace/data'],
                id: 'move-data',
                entrypoint: 'bash',
            },
            // Step 9: Pull Agent from Firebase Storage
            {
                name: 'gcr.io/cloud-builders/gsutil',
                args: ['-m', 'cp', '-r', sourceLocation, '/workspace/agent'],
                id: 'copy-agent-from-storage'
            },
            // Step 10: Build the Docker Image
            {
                name: 'gcr.io/cloud-builders/docker',
                args: [
                    'build',
                    '-t', imageName,
                    '.'
                ],
                extra_args: [
                    '--network=none',
                    '--no-cache',
                    '--cap-drop=ALL',
                    '--security-opt', 'no-new-privileges',
                ],
                id: 'build-agent-test-image'
            },
            // Step 11: Run the backtest container WITH network isolation
            {
                name: 'gcr.io/cloud-builders/docker',
                entrypoint: 'bash',
                args: [
                    '-c',
                    `set -e; set -o pipefail; \
                     docker run \\
                      --rm \\
                      --network=none \\
                      --read-only \\
                      --security-opt no-new-privileges \\
                      --cap-drop ALL \\
                      -v /workspace:/workspace \\
                      ${imageName} \\
                      > /workspace/output.json`
                ],
                id: 'run-isolated-backtest',
            },
            // Step 12: Process the output file
            {
                name: 'node:22',
                entrypoint: 'bash',
                args: [
                    '-c',
                    `npm install -g firebase-tools && \
                     if firebase database:update ${resultsPath} /workspace/output.json --project ${projectId} --force --debug; then
                         firebase database:update "/creators/${userId}/agents/${agentId}" --data '{"status": "success", "completedAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"}'
                     else
                         firebase database:update "/creators/${userId}/agents/${agentId}" --data '{"status": "failed", "error": "Backtest failed", "completedAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"}'
                         exit 1
                     fi`
                ],
                id: 'write-results-rtdb-firebase-cli',
                waitFor: ['run-isolated-backtest']
            }
        ],
        images: [
            imageName
        ],
        timeout: {
            seconds: 1200,  // 20 minutes
        }
    };

    // Submit the build
    const [operation] = await cloudbuild.createBuild({
        projectId: projectId,
        build: buildConfig
    });

    const buildId = operation.metadata.build.id;

    // Update agent with build information
    await firestore.collection('agents').doc(agentId).update({
        buildId: buildId,
        buildStatus: 'WORKING',
        backtestBuildConfig: buildConfig,
        updatedAt: new Date()
    });

    console.log(`Cloud Build triggered for agent ${agentId}, build ID: ${buildId}`);

    return {
        buildId,
        status: 'build_triggered',
        message: 'Automatic backtest build submitted to Cloud Build'
    };
}

/**
 * Validate agent code for security and structure
 */
function validateAgentCode(code) {
    try {
        // Check for blocked imports
        const lines = code.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
                const words = trimmed.split(' ');
                const importName = words[1]?.split('.')[0];
                if (BLOCKED_IMPORTS.has(importName)) {
                    return {
                        valid: false,
                        error: `Blocked import detected: ${importName}`
                    };
                }
            }
        }

        // Check for required structure (basic Backtrader strategy)
        const hasStrategyClass = /class\s+\w+\s*\(\s*bt\.Strategy\s*\)/i.test(code);
        const hasNextMethod = /def\s+next\s*\(/i.test(code);

        if (!hasStrategyClass) {
            return {
                valid: false,
                error: 'Code must contain a Backtrader Strategy class'
            };
        }

        if (!hasNextMethod) {
            return {
                valid: false,
                error: 'Strategy class must contain a next() method'
            };
        }

        return {
            valid: true,
            message: 'Code validation passed'
        };

    } catch (error) {
        return {
            valid: false,
            error: `Validation error: ${error.message}`
        };
    }
}

module.exports = router;