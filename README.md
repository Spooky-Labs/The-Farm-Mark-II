# Spooky Labs Trading Platform - Agent Submission Service

A minimal Firebase Functions service for submitting and processing trading agent code with automated backtesting via Cloud Build.

## Overview

This service provides a single API endpoint for uploading Python trading strategy files. When files are uploaded, they are stored in Cloud Storage and automatically trigger a backtesting pipeline.

## Architecture

```
functions/
├── index.js                     # Entry point
├── submitAgent.js               # HTTP endpoint for file uploads
├── updateAgentMetadata.js       # Storage-triggered backtesting
└── utils/
    ├── authUtils.js            # Firebase authentication
    ├── multipartFileUpload.js  # File upload handling
    └── backtestBuildConfig.js  # Cloud Build configuration
```

## Prerequisites

- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)
- Google Cloud Project with billing enabled
- Firebase Authentication enabled
- Cloud Storage and Cloud Build APIs enabled

## Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone [your-repo-url]
cd "The Farm Mark II"

# Install dependencies
cd functions
npm install
cd ..
```

### 2. Configure Firebase

```bash
# Login to Firebase
firebase login

# Set your project ID
firebase use YOUR-PROJECT-ID

# Or update .firebaserc manually
```

### 3. Create Storage Bucket

The service requires this Cloud Storage bucket:
- `YOUR-PROJECT-ID-agent-code` - For storing uploaded agent files

```bash
# Create bucket via gsutil
gsutil mb gs://YOUR-PROJECT-ID-agent-code
```

Note: Backtest results are stored in Firebase Realtime Database, not in a separate storage bucket.

## Deployment

For a complete deployment checklist, see `docs/DEPLOYMENT_CHECKLIST.md`.

### Deploy Everything

```bash
firebase deploy
```

This deploys:
- Cloud Functions (submitAgent, updateAgentMetadata)
- Database rules
- Storage rules

### Deploy Only Functions

```bash
firebase deploy --only functions

# Or specific functions
firebase deploy --only functions:submitAgent,functions:updateAgentMetadata
```

## API Endpoint

After deployment, your API will be available at:

```
https://us-central1-YOUR-PROJECT-ID.cloudfunctions.net/submitAgent
```

### Submit Agent

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

const response = await fetch('https://us-central1-YOUR-PROJECT-ID.cloudfunctions.net/submitAgent', {
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

1. **User uploads files** via submitAgent endpoint
2. **Files stored** in Cloud Storage at `agents/{userId}/{agentId}/`
3. **Storage trigger** fires updateAgentMetadata function
4. **Metadata saved** to Firebase Realtime Database
5. **Cloud Build job** submitted for backtesting
6. **Backtest results** written to Database at `/creators/{userId}/agents/{agentId}/backtest`

## Database Structure

```
agents/
  {userId}/
    {agentId}/
      - agentId        # Firebase push key format
      - userId
      - timestamp
      - numberOfFiles
      - status         # 'stored' | 'building' | 'completed' | 'failed'
      - bucketName
      - buildId        # Cloud Build job ID

users/
  {userId}/
    agents/
      {agentId}/       # Mirror of agents/{userId}/{agentId}

creators/
  {userId}/
    agents/
      {agentId}/
        - status       # 'success' | 'failed'
        - completedAt  # ISO timestamp
        backtest/      # Backtest results JSON from runner.py
          - (backtest output data)
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
  http://localhost:5001/YOUR-PROJECT-ID/us-central1/submitAgent \
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
https://console.cloud.google.com/functions/list?project=YOUR-PROJECT-ID
```

## Security

- **Authentication**: All endpoints require Firebase Authentication
- **File Validation**: Only Python files (.py) accepted
- **Size Limits**: 10MB max per file
- **Database Rules**: User data isolation enforced
- **Storage Rules**: Authenticated access only

## Environment Variables

The following are automatically available:
- `GCLOUD_PROJECT` - Your project ID
- `FIREBASE_CONFIG` - Firebase configuration

## Cost Estimation

For moderate usage (1000 submissions/month):
- **Cloud Functions**: ~$0 (free tier: 2M invocations/month)
- **Cloud Storage**: ~$0.02 (for 1GB storage)
- **Cloud Build**: ~$3 (120 build-minutes free, then $0.003/minute)
- **Database**: ~$1 (for 1GB stored)
- **Total**: ~$5/month

## Troubleshooting

### Function Not Found
```bash
# Check deployment status
firebase deploy --only functions --debug
```

### Storage Trigger Not Firing
- Ensure firebase-admin SDK is version 9.7.0+
- Check that buckets exist and have correct names
- Verify storage rules allow write access

### Authentication Errors
- Ensure Firebase Authentication is enabled in console
- Check that ID token is valid and not expired
- Verify Authorization header format: `Bearer {token}`

## Support

For issues or questions:
- Check `docs/` folder for detailed documentation
- View logs with `firebase functions:log`
- Open an issue on GitHub

## License

Proprietary - Spooky Labs