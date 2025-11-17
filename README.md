# Spooky Labs Trading Platform - Agent Submission Service

A minimal Firebase Functions service for submitting and processing trading agent code with automated backtesting via Cloud Build.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Deployment](#deployment)
- [API Endpoints](#api-endpoints)
- [Process Flow](#process-flow)
- [Database Structure](#database-structure)
- [Local Development](#local-development)
- [API Documentation](#api-documentation)
- [Monitoring](#monitoring)
- [Security](#security)
- [Cost Estimation](#cost-estimation)
- [Troubleshooting](#troubleshooting)
- [Additional Documentation](#additional-documentation)
- [Support](#support)

## Overview

This service provides API endpoints for managing trading agents and broker accounts:
- Upload Python trading strategy files
- Create Alpaca broker accounts for trading
- Fund accounts with paper money
- Deploy agents to GKE cluster for live paper trading
- Automatically trigger backtesting pipelines
- Support for both JavaScript and Python functions

## Architecture

```
functions/                       # JavaScript functions
├── index.js                     # Entry point
├── submitAgent.js               # HTTP endpoint for file uploads
├── updateAgentMetadata.js       # Storage-triggered backtesting
├── beginPaperTrading.js         # Deploy agents to GKE cluster
└── utils/
    ├── authUtils.js            # Firebase authentication
    ├── multipartFileUpload.js  # File upload handling
    └── backtestBuildConfig.js  # Cloud Build configuration

python-functions/                # Python functions
├── main.py                      # Entry point - imports all functions
├── create_account.py            # createAccount - Alpaca account registration
├── fund_account.py              # fundAccount - Account funding via ACH
├── requirements.txt             # Python dependencies (firebase-functions, firebase-admin, alpaca-py)
└── venv/                        # Python virtual environment (gitignored)
```

## Prerequisites

- Node.js 20+ (Node.js 18 is deprecated as of April 2025)
- Python 3.12+ (for Python functions)
- Firebase CLI (`npm install -g firebase-tools`)
- Google Cloud Project with billing enabled
- Firebase Authentication enabled
- Cloud Storage and Cloud Build APIs enabled
- Alpaca Broker API credentials (for Python functions)

## Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone [your-repo-url]
cd "The Farm Mark II"

# Install JavaScript dependencies
cd functions
npm install
cd ..

# Install Python dependencies
cd python-functions
python3.12 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
deactivate
cd ..
```

### 2. Configure Firebase

```bash
# Login to Firebase
firebase login

# Set your project ID
firebase use the-farm-neutrino-315cd

# Or update .firebaserc manually
```

### 3. Storage Bucket Configuration

The service uses Firebase Storage default bucket:
- `the-farm-neutrino-315cd.firebasestorage.app` - For all storage operations

This bucket is automatically created when you initialize Firebase Storage. No additional bucket creation is needed.

Note: Backtest results are stored in Firebase Realtime Database.

### 4. Configure Secrets (for Python Functions)

The Python functions use separate Alpaca API credentials for account creation and funding to maintain separation of concerns and avoid rate limits.

Run the setup script from the Spooky Labs root directory:

```bash
# Navigate to Spooky Labs root
cd "/Users/nonplus/Desktop/Spooky Labs"

# Run the setup script
bash setup_account_creation_secrets.sh
```

This script will prompt for two sets of credentials and create four secrets:
- `ACCOUNT_CREATION_BROKER_API_KEY` - For createAccount function
- `ACCOUNT_CREATION_BROKER_SECRET_KEY` - For createAccount function
- `ACCOUNT_FUNDING_BROKER_API_KEY` - For fundAccount function
- `ACCOUNT_FUNDING_BROKER_SECRET_KEY` - For fundAccount function

Alternatively, set them manually:

```bash
firebase functions:secrets:set ACCOUNT_CREATION_BROKER_API_KEY
firebase functions:secrets:set ACCOUNT_CREATION_BROKER_SECRET_KEY
firebase functions:secrets:set ACCOUNT_FUNDING_BROKER_API_KEY
firebase functions:secrets:set ACCOUNT_FUNDING_BROKER_SECRET_KEY
```

## Deployment

For a complete deployment checklist, see `docs/DEPLOYMENT_CHECKLIST.md`.

### Deploy Everything

```bash
firebase deploy
```

This deploys:
- JavaScript Cloud Functions (submitAgent, updateAgentMetadata)
- Python Cloud Functions (createAccount, fundAccount)
- Database rules
- Storage rules

Firebase Storage is initialized with the default bucket: `the-farm-neutrino-315cd.firebasestorage.app`

This single bucket handles all storage operations:
- Backend operations via Admin SDK in Cloud Functions
- Client-side operations via Firebase SDK with security rules

### Deploy Only Functions

```bash
firebase deploy --only functions

# Or specific codebases
firebase deploy --only functions:javascript-functions
firebase deploy --only functions:python-functions

# Or specific functions
firebase deploy --only functions:javascript-functions:submitAgent
firebase deploy --only functions:python-functions:createAccount
```

## API Endpoints

### JavaScript Functions

#### Submit Agent
- **URL**: `https://submitagent-emedpldi5a-uc.a.run.app`
- **Method**: POST
- **Purpose**: Upload trading strategy files

### Python Functions

#### Create Alpaca Account (createAccount)
- **URL**: `https://createaccount-emedpldi5a-uc.a.run.app`
- **Method**: POST
- **Purpose**: Create Alpaca paper trading account for an agent
- **Request Body**: `{"agentId": "agent-id-here"}`

#### Fund Alpaca Account (fundAccount)
- **URL**: `https://fundaccount-emedpldi5a-uc.a.run.app`
- **Method**: POST
- **Purpose**: Fund Alpaca account with $25,000 paper money
- **Request Body**: `{"agentId": "agent-id-here"}`

#### Begin Paper Trading (beginPaperTrading)
- **URL**: `https://us-central1-the-farm-neutrino-315cd.cloudfunctions.net/beginPaperTrading`
- **Method**: POST
- **Purpose**: Deploy funded agent to GKE cluster for live paper trading
- **Request Body**: `{"agentId": "agent-id-here"}`

Note: These are Gen 2 Cloud Function URLs. All endpoints require Firebase Authentication Bearer token.

### Submit Agent (Detailed)

**Request:**
- Method: `POST`
- Headers:
  - `Authorization: Bearer {FIREBASE_ID_TOKEN}`
  - `Content-Type: multipart/form-data`
- Body: Form data with Python files (max 10MB per file)

**Response (201 Created):**
```json
{
  "agentId": "-NjKlMnOpQrStUvWxYz",
  "timestamp": 1699123456789,
  "numberOfFiles": 2,
  "userId": "uid123"
}
```

**Example Usage:**

```javascript
const formData = new FormData();
formData.append('files', agentFile1);
formData.append('files', agentFile2);

const idToken = await firebase.auth().currentUser.getIdToken();

const response = await fetch('https://submitagent-emedpldi5a-uc.a.run.app', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${idToken}`
  },
  body: formData
});

const result = await response.json();
console.log('Agent ID:', result.agentId);
```

## Process Flow

### Agent Submission and Backtesting
1. **User uploads files** via submitAgent endpoint
2. **Files stored** in Cloud Storage at `agents/{userId}/{agentId}/`
3. **Storage trigger** fires updateAgentMetadata function
4. **Metadata saved** to Firebase Realtime Database with status `stored`
5. **Cloud Build job** submitted for backtesting (status → `building`)
6. **Backtest results** written to Database at `/creators/{userId}/agents/{agentId}/backtest`
7. **Status updated** to `success` or `failed`

### Alpaca Account Creation and Funding
1. **User calls createAccount** with agentId
2. **Python function** creates Alpaca paper trading account (status → `registering_account`)
3. **ACH relationship** created for account funding
4. **Status updated** to `account_registered`
5. **User calls fundAccount** with agentId
6. **Python function** initiates $25,000 ACH transfer (status → `funding`)
7. **Account funded** and status updated to `funded`

### Agent Deployment and Trading
1. **User calls beginPaperTrading** with agentId (agent must be `funded`)
2. **Cloud Build job** triggered to deploy agent (status → `deploying`)
3. **Runtime cloned**, agent code copied from Storage
4. **Docker image built** and pushed to GCR
5. **Kubernetes deployment** created in GKE cluster
6. **Status updated** to `trading` (or `deployment_failed` on error)

## Database Structure

```
agents/
  {userId}/
    {agentId}/
      - agentId        # Firebase push key format
      - userId
      - timestamp
      - numberOfFiles
      - status         # 'stored' | 'building' | 'success' | 'failed'
      - bucketName
      - buildId        # Cloud Build job ID

creators/
  {userId}/
    agents/
      {agentId}/
        - status                 # 'stored' | 'building' | 'success' | 'failed' | 'registering_account' | 'account_registered' | 'funded' | 'deploying' | 'trading' | 'deployment_failed'
        - originalName
        - timeCreated
        - numberOfFiles
        - completedAt            # ISO timestamp
        - alpacaAccount/
            - id                 # Alpaca account ID
            - status             # Alpaca account status
            - created_at         # Account creation timestamp
            - account_funding_status  # 'PENDING' | 'FUNDING' | 'FUNDED'
            - relationship_id    # ACH relationship ID
            - transfer_id        # ACH transfer ID
            - funding_amount     # "25000"
        - backtest/              # Backtest results JSON from runner.py
            - (backtest output data)
        - paperTrading/          # Deployment info (when deployed)
            - deploymentBuildId  # Cloud Build job ID
            - deploymentStarted  # Timestamp
            - kubernetes/
                - namespace      # 'paper-trading'
                - deploymentName # 'agent-{agentId}'
                - serviceAccount # 'trading-agent'
```

## Local Development

### Using Firebase Emulator

```bash
# Start emulators
firebase emulators:start

# The UI will be available at http://localhost:4000
```

For detailed emulator instructions, see `docs/RUN_EMULATOR.md`.

### Testing

```bash
# Test with cURL
curl -X POST \
  http://localhost:5001/the-farm-neutrino-315cd/us-central1/submitAgent \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "files=@test-agent.py"
```

## API Documentation

Interactive API documentation is available in the `docs/` folder:

- `swagger.yaml` - OpenAPI specification
- `API_DOCUMENTATION.md` - Quick reference guide

To view the interactive documentation, see instructions in `docs/API_DOCUMENTATION.md`.

## Monitoring

### View Logs

```bash
# View function logs
firebase functions:log

# Follow logs in real-time
firebase functions:log --follow

# Filter by function
firebase functions:log --only submitAgent
```

### Google Cloud Console

Monitor your functions at:
```
https://console.cloud.google.com/functions/list?project=the-farm-neutrino-315cd
```

## Security

### Authentication & Authorization
- **All endpoints** require Firebase Authentication Bearer token
- **Database Rules**: Users can only read their own data (`creators/{uid}`)
- **Storage Rules**: All access denied by default (functions use Admin SDK)

### File Upload Security
- **File Validation**: Only Python files (.py) accepted
- **Size Limits**: 10MB max per file
- **Virus Scanning**: Not implemented (consider Cloud Security Scanner)

### Backtest Execution Security
- **Isolated Containers**: Each backtest runs in isolated Docker container
- **Network Isolation**: `--network=none` prevents internet access
- **Read-only Filesystem**: `--read-only` prevents file modification
- **No Privileges**: `--cap-drop ALL` removes all Linux capabilities
- **Resource Limits**: 20-minute timeout, 100GB disk limit

### Secret Management
- **Alpaca API Keys**: Stored in Firebase Secret Manager
- **Access Control**: Only Python functions can access secrets

## Environment Variables

The following are automatically available:
- `GCLOUD_PROJECT` - Your project ID
- `FIREBASE_CONFIG` - Firebase configuration

## Cost Estimation

### Free Tier Limits
- **Cloud Functions**: 2M invocations/month, 400,000 GB-seconds compute
- **Cloud Storage**: 5GB storage, 1GB/day downloads
- **Cloud Build**: 120 build-minutes/day
- **Realtime Database**: 1GB storage, 10GB/month downloads

### Estimated Costs (1000 submissions/month)
- **Cloud Functions**: ~$0 (well within free tier)
- **Cloud Storage**: ~$0.02 (for ~1GB storage)
- **Cloud Build**: ~$3-5 (assuming 5 min/backtest after free tier)
- **Realtime Database**: ~$1 (for 1GB stored data)
- **Total**: **~$5-7/month**

### Cost Optimization Tips
- Use emulators for local development
- Delete old agent files from Storage after backtesting
- Archive old backtest results to cheaper storage
- Monitor Cloud Build usage (largest cost driver)
- Use Cloud Build caching to speed up builds

## Troubleshooting

### JavaScript Functions

#### Function Not Found
```bash
# Check deployment status
firebase deploy --only functions --debug

# List deployed functions
firebase functions:list
```

#### Storage Trigger Not Firing
- Ensure firebase-admin SDK is version 9.7.0+ (check `functions/package.json`)
- Verify bucket name is `the-farm-neutrino-315cd.firebasestorage.app`
- Check Cloud Build API is enabled
- Review function logs: `firebase functions:log --only updateAgentMetadata`

#### Authentication Errors
- Ensure Firebase Authentication is enabled in console
- Check that ID token is valid and not expired (tokens expire after 1 hour)
- Verify Authorization header format: `Bearer {token}`
- Test with emulator first: `firebase emulators:start`

### Python Functions

#### Function Not Deploying
```bash
# Check Python version
python3.12 --version

# Verify secrets are set
firebase functions:secrets:access ALPACA_BROKER_API_KEY

# Deploy with debug
firebase deploy --only functions:python-functions --debug
```

#### Alpaca Account Creation Fails
- Verify Alpaca API credentials are correct
- Check that you're using sandbox mode (not production)
- Review error in function logs: `firebase functions:log --only createAccount`
- Ensure all required fields are provided (contact, identity, disclosures)

#### ACH Relationship Not Ready
- Wait 2-3 minutes after account creation before funding
- ACH relationships start in `QUEUED` status before becoming `APPROVED`
- Retry fundAccount after a few minutes

### Cloud Build Issues

#### Build Timeout
- Default timeout is 20 minutes (1200 seconds)
- Increase timeout in `backtestBuildConfig.js` if needed
- Check Course-1 repository is accessible

#### Build Fails to Start
- Verify Cloud Build API is enabled
- Check service account permissions
- Ensure Cloud Build has access to Storage bucket

## Additional Documentation

- **API Reference**: `docs/API_DOCUMENTATION.md` - Complete API specification and examples
- **Deployment Guide**: `docs/DEPLOYMENT_CHECKLIST.md` - Step-by-step deployment checklist
- **Multi-Language Functions**: `docs/MULTI_LANGUAGE_FUNCTIONS.md` - JavaScript & Python function setup
- **Emulator Guide**: `docs/RUN_EMULATOR.md` - Local development with Firebase emulators
- **Swagger Spec**: `swagger.yaml` - OpenAPI 3.0.3 specification

## Support

For issues or questions:
- Check `docs/` folder for detailed documentation
- View logs with `firebase functions:log`
- Review Cloud Build logs: https://console.cloud.google.com/cloud-build/builds
- Open an issue on GitHub

## Related Repositories
- **Course-1**: Backtesting framework (https://github.com/Spooky-Labs/Course-1)
- **Developer Website**: Frontend console for managing agents

## License

Proprietary - Spooky Labs