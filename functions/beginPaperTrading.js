/**
 * Begin Paper Trading Function
 * Deploys funded agent to GKE cluster using pre-built runtime image
 *
 * Key improvements:
 * - Uses pre-built runtime image instead of rebuilding
 * - Builds thin layer with agent code on top
 * - More efficient and faster deployment
 */

const { onRequest } = require('firebase-functions/v2/https');
const { CloudBuildClient } = require('@google-cloud/cloudbuild');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const { verifyIdToken } = require('./utils/authUtils');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();
const cloudbuild = new CloudBuildClient();
const projectId = process.env.GCLOUD_PROJECT || process.env.PROJECT_ID;
const bucketName = process.env.STORAGE_BUCKET || `${projectId}.firebasestorage.app`;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

/**
 * POST / - Begin paper trading for agent
 */
app.post('/', verifyIdToken, async (req, res) => {
  const userId = req.body.decodedToken.uid;
  const { agentId } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'Missing agentId' });
  }

  // Sanitize agentId for Docker/Kubernetes (must be lowercase, no underscores, can't start with hyphen)
  const normalizedAgentId = agentId
    .toLowerCase()
    .replace(/_/g, '-')           // Replace underscores with hyphens
    .replace(/^-+/, '')            // Remove leading hyphens
    .replace(/[^a-z0-9-]/g, '-');  // Replace any other invalid chars with hyphen

  try {
    // Verify agent is ready
    const agentRef = db.ref(`creators/${userId}/agents/${agentId}`);
    const agentSnapshot = await agentRef.once('value');
    const agentData = agentSnapshot.val();

    if (!agentData) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (agentData.alpacaAccount?.account_funding_status !== 'FUNDED') {
      return res.status(400).json({
        error: 'Agent must be funded',
        status: agentData.alpacaAccount?.account_funding_status
      });
    }

    if (agentData.status === 'deploying' || agentData.status === 'trading') {
      return res.status(400).json({
        error: 'Agent already deployed',
        status: agentData.status
      });
    }

    // Get Alpaca account ID for trading
    const alpacaAccountId = agentData.alpacaAccount?.id;
    if (!alpacaAccountId) {
      return res.status(400).json({ error: 'Alpaca account ID not found' });
    }

    // Build and deploy using pre-built runtime as base
    const [operation] = await cloudbuild.createBuild({
      projectId,
      build: {
        steps: [
          {
            id: 'create-dockerfile',
            name: 'bash',
            args: ['-c', `cat > /workspace/Dockerfile <<'EOF'
# Use pre-built runtime as base
FROM gcr.io/${projectId}/runtime:latest

# Switch to root to copy files
USER root

# Create agent directory
RUN mkdir -p /app/agent && chown -R trader:trader /app/agent

# Copy agent code will be done by next step
WORKDIR /app

# Switch back to trader user
USER trader

# Agent code will override the strategy
CMD ["python", "runner.py"]
EOF`]
          },
          {
            id: 'copy-agent-code',
            name: 'gcr.io/cloud-builders/gsutil',
            args: ['cp', '-r', `gs://${bucketName}/agents/${userId}/${agentId}/*`, '/workspace/agent/']
            // Copy user's agent code from Firebase Storage
          },
          {
            id: 'build-agent-image',
            name: 'gcr.io/cloud-builders/docker',
            args: [
              'build',
              '-t', `gcr.io/${projectId}/agent-${normalizedAgentId}:latest`,
              '-f', '/workspace/Dockerfile',
              '/workspace'
            ]
            // Build thin layer on top of runtime base image
          },
          {
            id: 'push-agent-image',
            name: 'gcr.io/cloud-builders/docker',
            args: ['push', `gcr.io/${projectId}/agent-${normalizedAgentId}:latest`]
            // Push agent-specific image to registry
          },
          {
            id: 'write-manifest',
            name: 'bash',
            args: ['-c', `cat > /workspace/deployment.yaml <<'EOF'
${generateK8sManifest(normalizedAgentId, agentId, userId, alpacaAccountId, projectId)}
EOF`]
            // Write Kubernetes manifest to file
          },
          {
            id: 'deploy-to-gke',
            name: 'gcr.io/cloud-builders/kubectl',
            env: ['CLOUDSDK_COMPUTE_REGION=us-central1', 'CLOUDSDK_CONTAINER_CLUSTER=paper-trading-cluster'],
            args: ['apply', '-f', '/workspace/deployment.yaml']
            // Deploy to GKE Autopilot cluster in paper-trading namespace
          }
        ],
        timeout: { seconds: 300 }  // Reduced from 600s since we're not rebuilding runtime
      }
    });

    const buildId = operation.metadata.build.id;

    await agentRef.update({
      status: 'deploying',
      paperTrading: {
        deploymentBuildId: buildId,
        deploymentStarted: admin.database.ServerValue.TIMESTAMP,
        kubernetes: {
          namespace: 'paper-trading',
          deploymentName: `agent-${normalizedAgentId}`,
          serviceAccount: 'trading-agent',
          image: `gcr.io/${projectId}/agent-${normalizedAgentId}:latest`
        }
      },
      error: null
    });

    res.json({ success: true, agentId, buildId, status: 'deploying' });

  } catch (error) {
    console.error('Deployment error:', error);
    res.status(500).json({ error: 'Deployment failed', message: error.message });
  }
});

function generateK8sManifest(normalizedAgentId, agentId, userId, alpacaAccountId, projectId) {
  return `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-${normalizedAgentId}
  namespace: paper-trading
  labels:
    app: trading-agent
    agent-id: "${normalizedAgentId}"
    user-id: "${userId}"
spec:
  replicas: 1
  selector:
    matchLabels:
      agent-id: "${normalizedAgentId}"
  template:
    metadata:
      labels:
        app: trading-agent
        agent-id: "${normalizedAgentId}"
        user-id: "${userId}"
    spec:
      serviceAccountName: trading-agent
      containers:
      - name: agent
        image: gcr.io/${projectId}/agent-${normalizedAgentId}:latest
        imagePullPolicy: Always
        env:
        - name: AGENT_ID
          value: "${agentId}"
        - name: USER_ID
          value: "${userId}"
        - name: ALPACA_ACCOUNT_ID
          value: "${alpacaAccountId}"
        # Runtime will get these from Secret Manager via Workload Identity
        # No need to pass secret names as the runner.py hardcodes them
        - name: PROJECT_ID
          valueFrom:
            configMapKeyRef:
              name: trading-config
              key: project_id
        - name: GOOGLE_CLOUD_PROJECT
          valueFrom:
            configMapKeyRef:
              name: trading-config
              key: project_id
        - name: REDIS_HOST
          valueFrom:
            configMapKeyRef:
              name: trading-config
              key: redis_host
        - name: REDIS_PORT
          valueFrom:
            configMapKeyRef:
              name: trading-config
              key: redis_port
        - name: MARKET_DATA_TOPIC
          valueFrom:
            configMapKeyRef:
              name: trading-config
              key: market_data_topic
        - name: CRYPTO_DATA_TOPIC
          valueFrom:
            configMapKeyRef:
              name: trading-config
              key: crypto_data_topic
        # Volume mount for agent code
        volumeMounts:
        - name: agent-code
          mountPath: /app/agent
          readOnly: true
        resources:
          requests:
            cpu: "500m"      # Increased from 250m for model inference
            memory: "1Gi"    # Increased from 512Mi for models
          limits:
            cpu: "2000m"     # Increased from 1000m
            memory: "4Gi"    # Increased from 2Gi for HuggingFace models
        livenessProbe:
          exec:
            command: ["pgrep", "-f", "runner.py"]
          initialDelaySeconds: 60  # Increased to allow model loading
          periodSeconds: 30
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          exec:
            command: ["pgrep", "-f", "runner.py"]
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
      volumes:
      - name: agent-code
        emptyDir: {}
      restartPolicy: Always
`;
}

exports.beginPaperTrading = onRequest({ cors: true, region: 'us-central1' }, app);