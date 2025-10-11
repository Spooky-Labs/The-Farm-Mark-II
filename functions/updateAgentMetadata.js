/**
 * Update Agent Metadata Function
 * Storage-triggered function that runs backtesting when agent files are uploaded
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const { CloudBuildClient } = require('@google-cloud/cloudbuild');
const { createBacktestBuildConfig } = require('./backtestBuildConfig');

// Initialize if not already done
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.database();
const storage = new Storage();
const cloudbuild = new CloudBuildClient();

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.PROJECT_ID;
const BUCKET_NAME = `${PROJECT_ID}-agent-code`;

/**
 * Update Agent Metadata - Triggered when files uploaded to Cloud Storage
 * Automatically starts backtesting via Cloud Build
 */
exports.updateAgentMetadata = functions.storage
    .bucket(BUCKET_NAME)
    .object()
    .onFinalize((object) => {
        const filePath = object.name;

        // Parse the file path: agents/{userId}/{agentId}/{filename}
        const pathParts = filePath.split('/');
        if (pathParts.length !== 4 || pathParts[0] !== 'agents') {
            console.log('Skipping non-agent file:', filePath);
            return Promise.resolve();
        }

        const userId = pathParts[1];
        const agentId = pathParts[2];
        const filename = pathParts[3];

        // Only process Python files
        if (!filename.endsWith('.py')) {
            console.log('Skipping non-Python file:', filePath);
            return Promise.resolve();
        }

        console.log(`Processing agent upload - User: ${userId}, Agent: ${agentId}, File: ${filename}`);

        // Get all files for this agent to build complete metadata
        const bucket = storage.bucket(BUCKET_NAME);
        const agentPath = `agents/${userId}/${agentId}/`;

        return bucket.getFiles({ prefix: agentPath })
            .then(([files]) => {
                // Filter to only Python files
                const pythonFiles = files.filter(f => f.name.endsWith('.py'));

                // Build file metadata
                const fileMetadata = pythonFiles.map(f => ({
                    name: f.name.split('/').pop(),
                    path: f.name,
                    uploadedAt: object.timeCreated
                }));

                // Update database with complete agent metadata
                const agentData = {
                    agentId,
                    userId,
                    timestamp: Date.parse(object.timeCreated),
                    numberOfFiles: pythonFiles.length,
                    status: 'submitted',
                    files: fileMetadata,
                    bucketName: BUCKET_NAME,
                    backtestStatus: 'pending',
                    backtestStartedAt: new Date().toISOString()
                };

                // Store in both locations for backward compatibility
                const updates = {};
                updates[`agents/${userId}/${agentId}`] = agentData;
                updates[`users/${userId}/agents/${agentId}`] = agentData;

                return db.ref().update(updates);
            })
        .then(() => {
            // Create Cloud Build configuration for backtesting
            const buildConfig = createBacktestBuildConfig({
                projectId: PROJECT_ID,
                agentId: agentId,
                userId: userId,
                bucketName: BUCKET_NAME,
                filePath: filePath
            });

            // Submit build to Cloud Build
            return cloudbuild.createBuild({
                projectId: PROJECT_ID,
                build: buildConfig
            });
        })
        .then(results => {
            const [operation] = results;
            const buildId = operation.name.split('/').pop();
            console.log(`Started Cloud Build: ${buildId} for agent: ${agentId}`);

            // Update database with build ID in both locations
            const buildUpdates = {};
            buildUpdates[`agents/${userId}/${agentId}/backtestStatus`] = 'running';
            buildUpdates[`agents/${userId}/${agentId}/backtestBuildId`] = buildId;
            buildUpdates[`agents/${userId}/${agentId}/backtestUpdatedAt`] = new Date().toISOString();
            buildUpdates[`users/${userId}/agents/${agentId}/backtestStatus`] = 'running';
            buildUpdates[`users/${userId}/agents/${agentId}/backtestBuildId`] = buildId;
            buildUpdates[`users/${userId}/agents/${agentId}/backtestUpdatedAt`] = new Date().toISOString();

            return db.ref().update(buildUpdates);
        })
        .catch(error => {
            console.error('Error processing agent upload:', error);

            // Update database with error in both locations
            const errorUpdates = {};
            errorUpdates[`agents/${userId}/${agentId}/backtestStatus`] = 'failed';
            errorUpdates[`agents/${userId}/${agentId}/backtestError`] = error.message;
            errorUpdates[`agents/${userId}/${agentId}/backtestFailedAt`] = new Date().toISOString();
            errorUpdates[`users/${userId}/agents/${agentId}/backtestStatus`] = 'failed';
            errorUpdates[`users/${userId}/agents/${agentId}/backtestError`] = error.message;
            errorUpdates[`users/${userId}/agents/${agentId}/backtestFailedAt`] = new Date().toISOString();

            return db.ref().update(errorUpdates);
        });
    });