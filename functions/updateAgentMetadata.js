/**
 * Update Agent Metadata Function
 * Storage-triggered function that runs backtesting when agent files are uploaded
 */

const { onObjectFinalized } = require('firebase-functions/v2/storage');
const admin = require('firebase-admin');
const { CloudBuildClient } = require('@google-cloud/cloudbuild');
const logger = require('firebase-functions/logger');
const { createBacktestBuildConfig } = require('./utils/backtestBuildConfig');

// Initialize if not already done
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.database();
const cloudbuild = new CloudBuildClient();

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.PROJECT_ID;
const BUCKET_NAME = 'agents-2r5r6'; // Using existing storage bucket

/**
 * Update Agent Metadata - Triggered when files uploaded to Cloud Storage
 * Automatically starts backtesting via Cloud Build
 */
exports.updateAgentMetadata = onObjectFinalized({ bucket: BUCKET_NAME }, (event) => {
    console.log('Storage event triggered:', event);

    const userId = event.data.metadata.userId;
    const agentId = event.data.metadata.agentId;
    const filePath = event.data.name;
    const numberOfFiles = event.data.metadata.numberOfFiles;
    const originalName = event.data.metadata.originalName;

    // Create metadata object
    const metadata = {
        agentId: agentId,
        userId: userId,
        contentType: event.data.contentType,
        numberOfFiles: numberOfFiles,
        timeCreated: event.data.timeCreated,
        originalName: originalName,
        status: 'stored',
        bucketName: BUCKET_NAME
    };

    // Store in both database locations for backward compatibility
    const updates = {};
    updates[`agents/${userId}/${agentId}`] = metadata;
    updates[`users/${userId}/agents/${agentId}`] = metadata;

    return db.ref()
        .update(updates)
        .then(function() {
            // Create Cloud Build configuration for backtesting
            const buildConfig = createBacktestBuildConfig({
                projectId: PROJECT_ID,
                agentId: agentId,
                userId: userId,
                bucketName: BUCKET_NAME
            });

            logger.log(`Starting backtest build for agent ${agentId}`);

            // Submit build to Cloud Build
            return cloudbuild.createBuild({
                projectId: PROJECT_ID,
                build: buildConfig
            });
        })
        .then(function(operations) {
            const buildId = operations[0]?.metadata?.build?.id || 'unknown';

            logger.log(`Build submitted for agent ${agentId}`, {
                buildId: buildId,
                userId: userId,
                agentId: agentId
            });

            // Update database with build ID and status in both locations
            const buildUpdates = {};
            buildUpdates[`agents/${userId}/${agentId}/buildId`] = buildId;
            buildUpdates[`agents/${userId}/${agentId}/status`] = 'building';
            buildUpdates[`users/${userId}/agents/${agentId}/buildId`] = buildId;
            buildUpdates[`users/${userId}/agents/${agentId}/status`] = 'building';

            return db.ref().update(buildUpdates);
        })
        .catch(function(error) {
            logger.error(`Error triggering build for agent ${agentId}`, error);

            // Update database with error in both locations
            const errorUpdates = {};
            errorUpdates[`agents/${userId}/${agentId}/status`] = 'failed';
            errorUpdates[`agents/${userId}/${agentId}/error`] = error.message;
            errorUpdates[`users/${userId}/agents/${agentId}/status`] = 'failed';
            errorUpdates[`users/${userId}/agents/${agentId}/error`] = error.message;

            return db.ref().update(errorUpdates);
        });
});