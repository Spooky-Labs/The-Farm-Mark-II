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

    // HuggingFace model cache size - increase as model library grows
    const CACHE_SIZE_GB = 20;

    return {
        steps: [
            // Step 0: Clone Course-1 repository from GitHub
            {
                name: 'gcr.io/cloud-builders/git',
                args: ['clone', 'https://github.com/Spooky-Labs/Course-1.git'],
                id: 'clone-course-1',
                entrypoint: 'git', // Needed to prevent errors in subsequent steps
            },
            // Step 1: Move Dockerfile to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/Dockerfile /workspace'],
                id: 'move-dockerfile',
                entrypoint: 'bash',
            },
            // Step 2: Move requirements.txt to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/requirements.txt /workspace'],
                id: 'move-requirements',
                entrypoint: 'bash',
            },
            // Step 3: Move runner.py to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/runner.py /workspace'],
                id: 'move-runner',
                entrypoint: 'bash',
            },
            // Step 4: Move symbols.txt to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/symbols.txt /workspace'],
                id: 'move-symbols',
                entrypoint: 'bash',
            },
            // Step 5: Create data directory
            {
                name: 'ubuntu',
                args: ['-c', 'mkdir -p /workspace/data'],
                id: 'create-data-dir',
                entrypoint: 'bash',
            },
            // Step 6: Create output directory
            {
                name: 'ubuntu',
                entrypoint: 'mkdir',
                args: ['-p', '/workspace/output'],
                id: 'create-output-dir'
            },
            // Step 7: Move data files to workspace
            {
                name: 'ubuntu',
                args: ['-c', 'mv /workspace/Course-1/data/* /workspace/data'],
                id: 'move-data',
                entrypoint: 'bash',
            },
            // Step 8: Copy agent code from Cloud Storage
            {
                name: 'gcr.io/cloud-builders/gsutil',
                args: ['-m', 'cp', '-r', sourceLocation, '/workspace/agent'],
                id: 'copy-agent-from-storage'
            },
            // Step 9: Build Docker image with agent code
            {
                name: 'gcr.io/cloud-builders/docker',
                args: ['build', '-t', imageName, '--no-cache', '.'],
                id: 'build-agent-test-image'
            },
            // Step 10: Run isolated backtest container with read-only filesystem
            // Security layers:
            //   --network=none: No internet access (offline mode)
            //   --read-only: Entire filesystem immutable
            //   --tmpfs /tmp: Small writable temp space (2GB, no execution)
            //   --tmpfs /home/appuser/.cache: Writable cache for HuggingFace lock files (configurable GB, NO execution)
            //   --security-opt no-new-privileges: Prevents privilege escalation
            //   --cap-drop ALL: Removes all Linux capabilities
            //
            // Why tmpfs for /home/appuser/.cache?
            //   HuggingFace writes .lock files using flock() system calls when loading models
            //   Models are copied here from /opt/models by entrypoint script
            //   noexec is safe: Lock files don't execute code, they just use file locking syscalls
            //   Size accommodates model cache + lock files + buffer (adjustable via CACHE_SIZE_GB)
            {
                name: 'gcr.io/cloud-builders/docker',
                entrypoint: 'bash',
                args: [
                    '-c',
                    `set -e; set -o pipefail; docker run --rm --network=none --read-only \
                     --tmpfs /tmp:rw,noexec,nosuid,size=2g \
                     --tmpfs /home/appuser/.cache:rw,noexec,nosuid,size=${CACHE_SIZE_GB}g,uid=1000,gid=1000 \
                     --security-opt no-new-privileges \
                     --cap-drop ALL \
                     -v /workspace:/workspace \
                     ${imageName} > /workspace/output.json`
                ],
                id: 'run-isolated-backtest',
            },

            // Step 11: Write backtest results to Realtime Database
            {
                name: 'node:20',
                entrypoint: 'bash',
                args: [
                    '-c',
                    `npm install -g firebase-tools && firebase database:update ${resultsPath} /workspace/output.json --project ${projectId} --force --debug`
                ],
                id: 'write-results-rtdb-firebase-cli',
                waitFor: ['run-isolated-backtest']
            },
            // Step 12: Write success message to database on success
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
            seconds: 1800,  // 20 minutes (or whatever duration you need)
            // nanos: 0, // Optional: Add nanoseconds if needed.
        },
        options: {
            machineType: 'E2_HIGHCPU_32',
            logging: 'CLOUD_LOGGING_ONLY',
            diskSizeGb: 200 // to support size of backtesting container (including whitelisted models from Hugging Face)
        }
    };
}

module.exports = {
    createBacktestBuildConfig
};