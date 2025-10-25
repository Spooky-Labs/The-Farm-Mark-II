/**
 * Submit Agent Function
 * Handles uploading Python trading strategy files
 * Maintains backward compatibility with original implementation
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const { multipartFileUpload } = require('./utils/multipartFileUpload');
const { verifyIdToken } = require('./utils/authUtils');

// Initialize if not already done
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.database();
const storage = new Storage();
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.PROJECT_ID;
const BUCKET_NAME = 'the-farm-neutrino-315cd.firebasestorage.app'; // Using Firebase Storage default bucket
const bucket = storage.bucket(BUCKET_NAME);

// Create Express app
const app = express();

// CORS Setup - allows all origins
app.use(cors({ origin: true }));

/**
 * Promise maker function - matches original implementation
 * Handles multiple file uploads with proper metadata
 */
const promiseMaker = function(request) {
    const userId = request.body.decodedToken.uid;
    const agentId = db.ref().child("agents").child(userId).push().key;
    const timestamp = Date.now();
    const numberOfFiles = request.files.length;

    request.body.responseObject = {
        agentId: agentId,
        timestamp: timestamp,
        numberOfFiles: numberOfFiles,
        userId: userId
    };

    return Promise.all(request.files.map(file => {
        // Set correct metadata - matches original
        const metadata = {
            metadata: {
                contentType: file.mimetype,
                metadata: {
                    agentId: agentId,
                    userId: userId,
                    originalName: file.originalname,
                    uploadTimestamp: timestamp,
                    numberOfFiles: numberOfFiles
                }
            },
            public: false,
            validation: 'md5'
        };

        const filePath = `agents/${userId}/${agentId}/${file.originalname}`;
        return bucket.file(filePath).save(file.buffer, metadata);
    }))
    .then(function(saveResponses) {
        request.saveResponses = saveResponses;
        return Promise.resolve(request);
    });
};

/**
 * Submit Agent Route
 * POST / with multipartFileUpload middleware
 *
 * Flow: multipartFileUpload -> verifyIdToken -> validate -> upload -> respond
 */
app.post('/', multipartFileUpload, verifyIdToken, (req, res) => {
    console.log("Starting Agent Submission Request");

    // Files are populated by multipartFileUpload middleware in req.files
    // Upload files to Cloud Storage
    // Database updates and backtesting will be handled by updateAgentMetadata storage trigger
    return promiseMaker(req)
        .then(function(processedRequest) {
            const responseObj = processedRequest.body.responseObject;

            console.log("Completed file upload");

            // Return response matching original Cloud Function format
            // Storage trigger (updateAgentMetadata) will handle database updates
            res.status(201).send(responseObj);
        })
        .catch(function(error) {
            console.error('Error submitting agent:', error);
            res.status(500).send({
                error: 'Internal server error',
                debug: error.message
            });
        });
});

// Export as Firebase Function (Gen 2)
exports.submitAgent = onRequest({
    cors: true,
    region: 'us-central1'
}, app);