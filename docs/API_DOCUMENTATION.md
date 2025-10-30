# The Farm Trading Agent API Documentation

## Overview
This repository contains OpenAPI/Swagger documentation for the Firebase Functions that power The Farm Trading Agent platform.

## API Specification
- **`swagger.yaml`** - OpenAPI 3.0.3 specification file containing complete API documentation

## Available Endpoints

### HTTP Endpoints
1. **POST /submitAgent** - Upload trading strategy files
2. **POST /createAccount** - Create Alpaca paper trading account
3. **POST /fundAccount** - Fund Alpaca account with $25,000

### Storage Triggers (Not in Swagger)
- **updateAgentMetadata** - Automatically triggered when files are uploaded to Firebase Storage

## Viewing the Documentation

### Option 1: Swagger Editor (Recommended)
1. Go to https://editor.swagger.io/
2. Copy the contents of `swagger.yaml`
3. Paste into the editor
4. View the interactive documentation on the right panel

### Option 2: Swagger UI Online
1. Go to https://petstore.swagger.io/
2. Enter the URL to your raw `swagger.yaml` file
3. Click "Explore"

### Option 3: VS Code Extension
Install the "Swagger Viewer" or "OpenAPI (Swagger) Editor" extension in VS Code to preview `swagger.yaml` directly

### Option 4: Import to API Tools
The `swagger.yaml` file can be imported into:
- Postman (Import → File → Upload `swagger.yaml`)
- Insomnia (Import → From File → Select `swagger.yaml`)
- Stoplight Studio
- ReadMe.io
- Any OpenAPI-compatible tool

## Authentication
All HTTP endpoints require Firebase Authentication. Include the Firebase ID token in the Authorization header:
```
Authorization: Bearer <firebase-id-token>
```

## Base URL
```
https://us-central1-the-farm-neutrino-315cd.cloudfunctions.net
```

## API Workflow

### Creating and Funding an Agent Account
1. **Submit Agent** → Upload trading strategy files
2. **Create Account** → Set up Alpaca paper trading account
3. **Fund Account** → Add $25,000 to the account

### Example Usage

#### 1. Submit Agent Files
```bash
curl -X POST https://us-central1-the-farm-neutrino-315cd.cloudfunctions.net/submitAgent \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -F "files=@strategy.py" \
  -F "files=@config.py"
```

#### 2. Create Alpaca Account
```bash
curl -X POST https://us-central1-the-farm-neutrino-315cd.cloudfunctions.net/createAccount \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "YOUR_AGENT_ID"}'
```

#### 3. Fund the Account
```bash
curl -X POST https://us-central1-the-farm-neutrino-315cd.cloudfunctions.net/fundAccount \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "YOUR_AGENT_ID"}'
```

## Response Formats

### Success Response Example
```json
{
  "success": true,
  "agentId": "-NkXYZ123abc456def",
  "accountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "accountStatus": "ACTIVE"
}
```

### Error Response Example
```json
{
  "error": "Agent not found",
  "debug": "No agent with ID -NkXYZ123abc456def exists"
}
```

## Environment
- **Runtime**: Firebase Functions Gen 2
- **Regions**: us-central1
- **Languages**: Node.js 20, Python 3.12
- **Storage**: Firebase Storage (default bucket)
- **Database**: Firebase Realtime Database

## Security Notes
- All endpoints require valid Firebase Authentication
- The createAccount function uses hardcoded placeholder data for sandbox testing
- ACH transfers are simulated in the Alpaca sandbox environment
- Secrets are managed via Firebase Secret Manager

## Validation
The `swagger.yaml` file follows OpenAPI 3.0.3 specification standards. To validate:
- Use the Swagger Editor (https://editor.swagger.io/) - it will show validation errors
- Use online validators like https://apitools.dev/swagger-parser/online/

## Support
For issues or questions, contact support@spookylabs.ai