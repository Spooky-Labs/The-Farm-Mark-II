/**
 * Begin Paper Trading Function
 * Deploys funded agent to GKE cluster with Spooky Labs runtime
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

  // Normalize agentId for Docker/Kubernetes (must be lowercase)
  const normalizedAgentId = agentId.toLowerCase();

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

    // Build and deploy
    const [operation] = await cloudbuild.createBuild({
      projectId,
      build: {
        steps: [
          {
            id: 'clone-runtime',
            name: 'gcr.io/cloud-builders/git',
            args: ['clone', 'https://github.com/Spooky-Labs/runtime.git', '/workspace/runtime']
            // Clone Spooky Labs runtime framework (includes FMEL, broker, data feeds)
          },
          {
            id: 'copy-agent-code',
            name: 'gcr.io/cloud-builders/gsutil',
            args: ['cp', '-r', `gs://${bucketName}/agents/${userId}/${agentId}/*`, '/workspace/runtime/agent/']
            // Copy user's agent code from Firebase Storage into runtime/agent/ directory
          },
          {
            id: 'build-image',
            name: 'gcr.io/cloud-builders/docker',
            args: ['build', '-t', `gcr.io/${projectId}/agent-${normalizedAgentId}:latest`, '/workspace/runtime']
            // Build Docker image using runtime's Dockerfile with agent code embedded
          },
          {
            id: 'push-image',
            name: 'gcr.io/cloud-builders/docker',
            args: ['push', `gcr.io/${projectId}/agent-${normalizedAgentId}:latest`]
            // Push container image to Google Container Registry
          },
          {
            id: 'deploy-to-gke',
            name: 'gcr.io/cloud-builders/kubectl',
            env: ['CLOUDSDK_COMPUTE_REGION=us-central1', 'CLOUDSDK_CONTAINER_CLUSTER=paper-trading-cluster'],
            args: ['apply', '-f', '-'],
            stdin: generateK8sManifest(normalizedAgentId, agentId, userId, alpacaAccountId)
            // Deploy to GKE Autopilot cluster in paper-trading namespace
          }
        ],
        timeout: { seconds: 600 }
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
          serviceAccount: 'trading-agent'
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

function generateK8sManifest(normalizedAgentId, agentId, userId, alpacaAccountId) {
  return `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-${normalizedAgentId}
  namespace: paper-trading
spec:
  replicas: 1
  selector:
    matchLabels:
      agent-id: "${normalizedAgentId}"
  template:
    metadata:
      labels:
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
        - name: ALPACA_API_KEY
          valueFrom:
            secretKeyRef:
              name: broker-paper-trading
              key: api-key
        - name: ALPACA_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: broker-paper-trading
              key: secret-key
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
        resources:
          requests:
            cpu: "250m"
            memory: "512Mi"
          limits:
            cpu: "1000m"
            memory: "2Gi"
        livenessProbe:
          exec:
            command: ["pgrep", "-f", "runner.py"]
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          exec:
            command: ["pgrep", "-f", "runner.py"]
          initialDelaySeconds: 10
          periodSeconds: 10
      restartPolicy: Always
`;
}

exports.beginPaperTrading = onRequest({ cors: true, region: 'us-central1' }, app);
