/**
 * Cloud Build Configuration for Backtesting
 * Exact configuration from production Cloud Functions repository
 */

/**
 * Create Cloud Build configuration for backtesting an agent
 *
 * @param {Object} params - Configuration parameters
 * @param {string} params.projectId - GCP Project ID
 * @param {string} params.agentId - Agent ID
 * @param {string} params.userId - User ID
 * @param {string} params.bucketName - Storage bucket name
 * @returns {Object} Cloud Build configuration object
 */
function createBacktestBuildConfig(params) {
    const { projectId, agentId, userId, bucketName } = params;

    const imageName = `gcr.io/${projectId}/course-1:A${agentId}`;
    const sourceLocation = `gs://${bucketName}/agents/${userId}/${agentId}`;
    const resultsPath = `/creators/${userId}/agents/${agentId}/backtest`;

    return {
        steps: [
            // Step 1: Clone Course-1 repository from GitHub
            {
                name: 'gcr.io/cloud-builders/git',
                args: ['clone', 'https://github.com/Spooky-Labs/Course-1.git'],
                id: 'clone-course-1',
                entrypoint: 'git', // Needed to prevent errors in subsequent steps
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
            // Step 6: Create data directory
            {
                name: 'ubuntu',
                args: ['-c', 'mkdir -p /workspace/data'],
                id: 'create-data-dir',
                entrypoint: 'bash',
            },
            // Step 7: Create output directory
            {
                name: 'ubuntu',
                entrypoint: 'mkdir',
                args: ['-p', '/workspace/output'],
                id: 'create-output-dir'
            },
            // Step 8: Move data files to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/data/* /workspace/data'],
                id: 'move-data',
                entrypoint: 'bash',
            },
            // Step 9: Copy agent code from Cloud Storage
            {
                name: 'gcr.io/cloud-builders/gsutil',
                args: ['-m', 'cp', '-r', sourceLocation, '/workspace/agent'],
                id: 'copy-agent-from-storage'
            },
            // Step 10: Build Docker image with agent code
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
            // Step 11: Run isolated backtest container
            {
                name: 'gcr.io/cloud-builders/docker',
                entrypoint: 'bash',
                args: [
                    '-c',
                    `set -e; set -o pipefail; \
                 # Create a temporary directory for PyTorch
                 mkdir -p /workspace/tmp && chmod 777 /workspace/tmp; \
                 docker run \\
                  --rm \\
                  --network=none \\
                  --read-only \\
                  --tmpfs /tmp:rw,noexec,nosuid,size=1g \\
                  --tmpfs /var/tmp:rw,noexec,nosuid,size=1g \\
                  --security-opt no-new-privileges \\
                  --cap-drop ALL \\
                  -e TMPDIR=/tmp \\
                  -e TEMP=/tmp \\
                  -e TMP=/tmp \\
                  -v /workspace:/workspace \\
                  ${imageName} \\
                  > /workspace/output.json`
                ],
                id: 'run-isolated-backtest',
            },

            // Step 12: Write backtest results to Realtime Database
            {
                name: 'node:20',
                entrypoint: 'bash',
                args: [
                    '-c',
                    `npm install -g firebase-tools && \\ 
                    firebase database:update ${resultsPath} /workspace/output.json --project ${projectId} --force --debug`
                ],
                id: 'write-results-rtdb-firebase-cli',
                waitFor: ['run-isolated-backtest']
            },
            // Step 13: Write success message to database on success
            {
                name: 'node:20',
                entrypoint: 'bash',
                args: [
                    '-c',
                    `npm install -g firebase-tools && \\
                    if [ -f /workspace/output.json ]; then
                        firebase database:update "/creators/${userId}/agents/${agentId}" --data '{"status": "success", "completedAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"}' --project ${projectId} --force --non-interactive
                    else
                        firebase database:update "/creators/${userId}/agents/${agentId}" --data '{"status": "failed", "error": "Build failed - check logs", "completedAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"}' --project ${projectId} --force --non-interactive
                    fi`
                ],
                id: 'update-build-success-failure',
                waitFor: ['run-isolated-backtest']
            }
        ],
        images: [
            imageName
        ],
        timeout: {
            seconds: 1200,  // 20 minutes (or whatever duration you need)
            // nanos: 0, // Optional: Add nanoseconds if needed.
        }
    };
}

module.exports = {
    createBacktestBuildConfig
};