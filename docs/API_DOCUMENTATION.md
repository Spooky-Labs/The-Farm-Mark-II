# API Documentation - Trading Agent Submission

## Overview

Simple API for submitting trading agent code for automated backtesting.

## Files

- **`swagger.yaml`** - OpenAPI 3.0 specification
- **`swagger-ui.html`** - Interactive documentation viewer

## The API Endpoint

### POST `/submitAgent`

Submit Python trading agent files for backtesting.

**Authentication Required:** Yes (Firebase ID Token)

**Request:**
- Method: `POST`
- URL: `https://us-central1-YOUR-PROJECT-ID.cloudfunctions.net/submitAgent`
- Headers:
  - `Authorization: Bearer YOUR_FIREBASE_ID_TOKEN`
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

## Testing

### Example with cURL:
```bash
curl -X POST \
  https://us-central1-YOUR-PROJECT-ID.cloudfunctions.net/submitAgent \
  -H "Authorization: Bearer YOUR_FIREBASE_ID_TOKEN" \
  -F "files=@agent.py" \
  -F "files=@config.py"
```

### Example with JavaScript:
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

## What Happens After Submission

1. **Files uploaded** to Cloud Storage bucket
2. **Storage trigger** fires the `updateAgentMetadata` function
3. **Metadata saved** to Firebase Realtime Database
4. **Cloud Build** job triggered for backtesting
5. **Results stored** when backtesting completes

## Required Environment Variables

```bash
GCLOUD_PROJECT=your-project-id
```

## Deployment Files

Core files needed for deployment:

```
functions/
├── index.js                     # Entry point
├── submitAgent.js               # Main HTTP endpoint
├── updateAgentMetadata.js       # Storage-triggered function
└── utils/
    ├── authUtils.js            # Authentication middleware
    ├── multipartFileUpload.js  # File upload handler
    └── backtestBuildConfig.js  # Cloud Build configuration
```

## Viewing the Documentation

### Option 1: Standalone Version (No Server Needed)
Open `swagger-ui-standalone.html` directly in your browser:
- Just double-click the file
- Works offline, spec is embedded in the HTML

### Option 2: Local Server Version (References YAML)
This version loads the `swagger.yaml` file dynamically:

```bash
cd docs
./serve.sh
# Opens at: http://localhost:8080/swagger-ui-local.html
```

### Option 3: GitHub Version (If Your Repo is Public)
1. Edit `swagger-ui-github.html`
2. Replace `YOUR-GITHUB-USERNAME` and `YOUR-REPO-NAME`
3. Open the file in your browser (no server needed)

### Option 4: Online Tools
- Copy contents of `swagger.yaml` to https://editor.swagger.io