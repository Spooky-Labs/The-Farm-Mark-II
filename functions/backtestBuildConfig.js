/**
 * Cloud Build Configuration for Backtesting
 * Generates the build configuration for running agent backtests
 */

/**
 * Create Cloud Build configuration for backtesting an agent
 *
 * @param {Object} params - Configuration parameters
 * @param {string} params.projectId - GCP Project ID
 * @param {string} params.agentId - Agent ID
 * @param {string} params.userId - User ID
 * @param {string} params.bucketName - Storage bucket name
 * @param {string} params.filePath - Path to agent file in storage
 * @returns {Object} Cloud Build configuration object
 */
function createBacktestBuildConfig(params) {
    const { projectId, agentId, userId, bucketName, filePath } = params;

    return {
        steps: [
            // Step 1: Clone Course-1 repository (contains backtesting framework)
            {
                name: 'gcr.io/cloud-builders/git',
                args: ['clone', 'https://github.com/Spooky-Labs/Course-1.git', '/workspace/course1'],
                id: 'clone-course-1'
            },

            // Step 2: Download agent code from Cloud Storage
            {
                name: 'gcr.io/cloud-builders/gsutil',
                args: ['cp', `gs://${bucketName}/${filePath}`, '/workspace/agent_code.py'],
                id: 'download-agent'
            },

            // Step 3: Build Docker image with agent code
            {
                name: 'gcr.io/cloud-builders/docker',
                args: [
                    'build',
                    '-t', `gcr.io/${projectId}/backtest-${agentId}:latest`,
                    '-f', '/workspace/course1/Dockerfile',
                    '--build-arg', 'AGENT_FILE=/workspace/agent_code.py',
                    '/workspace/course1'
                ],
                id: 'build-image'
            },

            // Step 4: Run backtest in isolated container
            {
                name: 'gcr.io/cloud-builders/docker',
                entrypoint: 'bash',
                args: [
                    '-c',
                    `docker run \
                     --rm \
                     --network=none \
                     --memory=2g \
                     --cpus=1 \
                     -e PROJECT_ID=${projectId} \
                     -e AGENT_ID=${agentId} \
                     -e USER_ID=${userId} \
                     -e MODE=BACKTEST \
                     -e START_DATE=2023-01-01 \
                     -e END_DATE=2023-12-31 \
                     -e INITIAL_CASH=100000 \
                     gcr.io/${projectId}/backtest-${agentId}:latest \
                     > /workspace/results.json`
                ],
                id: 'run-backtest'
            },

            // Step 5: Upload results back to Cloud Storage
            {
                name: 'gcr.io/cloud-builders/gsutil',
                args: [
                    'cp',
                    '/workspace/results.json',
                    `gs://${projectId}-backtest-results/${userId}/${agentId}/results.json`
                ],
                id: 'upload-results'
            },

            // Step 6: Parse and store results in Realtime Database
            {
                name: 'gcr.io/cloud-builders/gcloud',
                entrypoint: 'bash',
                args: [
                    '-c',
                    `
                    # Read the results
                    RESULTS=$(cat /workspace/results.json)

                    # Update Firebase Realtime Database via REST API
                    curl -X PATCH \
                        "https://${projectId}-default-rtdb.firebaseio.com/users/${userId}/agents/${agentId}.json" \
                        -d '{"backtestStatus":"completed","backtestResults":'"\$RESULTS"',"backtestCompletedAt":"'$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")'"}'
                    `
                ],
                id: 'update-database'
            }
        ],
        timeout: '1800s',  // 30 minutes
        options: {
            machineType: 'E2_STANDARD_2',
            diskSizeGb: 20,
            logging: 'CLOUD_LOGGING_ONLY'
        }
    };
}

module.exports = {
    createBacktestBuildConfig
};