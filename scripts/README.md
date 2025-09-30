# Scripts

Automation scripts for deployment, testing, and maintenance.

## 📁 Directory Structure

```
scripts/
├── deployment/           # Deployment and setup scripts
│   ├── deploy.sh              # Main deployment script
│   ├── post-deploy-k8s.sh     # Post-deployment Kubernetes setup
│   └── setup-environment.sh   # Environment setup
├── testing/              # Testing and validation scripts
│   ├── test-deployment.sh         # Deployment verification
│   ├── test-integration.sh        # Integration tests
│   └── test-website-compatibility.js  # Website compatibility tests
└── utilities/            # Utility and maintenance scripts
    ├── cleanup.sh             # Cleanup resources
    └── verify-system.sh       # System verification
```

## 🚀 Deployment Scripts

### `deployment/deploy.sh`
Main deployment script that orchestrates the entire deployment process.

```bash
# Deploy all components
bash scripts/deployment/deploy.sh

# Deploy specific components
bash scripts/deployment/deploy.sh --cloud-functions-only
bash scripts/deployment/deploy.sh --kubernetes-only
```

**What it does:**
- Deploys Cloud Functions (api-gateway, create-account, fund-account)
- Deploys Kubernetes resources (data ingesters, paper trading)
- Sets up environment variables and secrets
- Validates deployment

### `deployment/post-deploy-k8s.sh`
Post-deployment Kubernetes configuration.

```bash
bash scripts/deployment/post-deploy-k8s.sh
```

**What it does:**
- Configures Kubernetes secrets
- Sets up service accounts
- Applies workload identity bindings
- Verifies pod status

### `deployment/setup-environment.sh`
Sets up the local development environment.

```bash
bash scripts/deployment/setup-environment.sh
```

**What it does:**
- Installs required dependencies
- Configures gcloud CLI
- Sets up environment variables
- Creates .env files from templates

## 🧪 Testing Scripts

### `testing/test-deployment.sh`
Comprehensive deployment verification (48 tests).

```bash
bash scripts/testing/test-deployment.sh
```

**Tests:**
- Cloud Functions endpoints
- Kubernetes pods status
- Pub/Sub topics and subscriptions
- BigQuery datasets and tables
- Redis connectivity
- Firestore collections

### `testing/test-integration.sh`
Integration tests for end-to-end flows.

```bash
bash scripts/testing/test-integration.sh
```

**Tests:**
- Agent submission flow
- Market data ingestion
- Paper trading execution
- FMEL recording
- Leaderboard updates

### `testing/test-website-compatibility.js`
Website compatibility tests (Node.js).

```bash
node scripts/testing/test-website-compatibility.js
```

**Tests:**
- Legacy endpoint compatibility
- API response formats
- Firebase authentication
- WebSocket connections

## 🛠️ Utility Scripts

### `utilities/cleanup.sh`
Cleanup resources and reset environment.

```bash
# Cleanup all resources
bash scripts/utilities/cleanup.sh

# Cleanup specific components
bash scripts/utilities/cleanup.sh --cloud-functions
bash scripts/utilities/cleanup.sh --kubernetes
```

**What it does:**
- Deletes Cloud Functions
- Removes Kubernetes deployments
- Cleans up Pub/Sub topics
- Optionally deletes BigQuery data

### `utilities/verify-system.sh`
System verification and health checks (48 checks).

```bash
bash scripts/utilities/verify-system.sh
```

**Checks:**
- All services running
- API endpoints responding
- Data flowing through pipeline
- Error rates within threshold
- Resource utilization

## 📋 Prerequisites

All scripts require:
- **gcloud CLI** - Authenticated with appropriate permissions
- **kubectl** - Configured for your GKE cluster
- **Node.js** - For JavaScript test scripts
- **Python 3.11+** - For Python scripts
- **.env file** - With required environment variables

## 🔧 Configuration

Create a `.env` file in the root directory:

```bash
# Copy from example
cp .env.example .env

# Edit with your values
PROJECT_ID=your-gcp-project
ALPACA_API_KEY=your-alpaca-key
ALPACA_SECRET_KEY=your-alpaca-secret
```

## 🚨 Troubleshooting

### Scripts fail with permission errors
```bash
# Make scripts executable
chmod +x scripts/**/*.sh
```

### gcloud authentication errors
```bash
# Re-authenticate
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### Kubernetes connection errors
```bash
# Get cluster credentials
gcloud container clusters get-credentials farm-cluster --region us-central1
```

## 📚 Additional Resources

- [Deployment Guide](../docs/deployment/DEPLOYMENT.md)
- [Operations Guide](../docs/operations/OPERATIONS.md)
- [Troubleshooting](../docs/operations/TROUBLESHOOTING.md) *(coming soon)*

---

**Last Updated:** 2025-09-30