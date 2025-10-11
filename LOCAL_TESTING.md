# Firebase Local Testing Setup Guide

## Important Limitation
⚠️ **Python functions (createAccount, fundAccount) cannot be tested locally with Firebase emulator** - only JavaScript functions are supported.

## Prerequisites

1. **Java JDK 11+** (required for emulators)
   ```bash
   # Check Java version
   java -version
   ```

2. **Node.js 18+**
   ```bash
   # Check Node version
   node --version
   ```

3. **Firebase CLI 8.14.0+**
   ```bash
   # Install or update Firebase CLI
   npm install -g firebase-tools

   # Check version
   firebase --version
   ```

## Setup Steps

### 1. Initialize Emulators
```bash
# From the project root
firebase init emulators
```

Select these emulators when prompted:
- ✅ Functions Emulator
- ✅ Database Emulator (Realtime Database)
- ✅ Storage Emulator
- ✅ Authentication Emulator
- ✅ Hosting Emulator (optional)
- ✅ Emulator UI

### 2. Configure Ports (accept defaults or customize)
Default ports:
- Functions: 5001
- Realtime Database: 9000
- Storage: 9199
- Authentication: 9099
- Hosting: 5000
- Emulator UI: 4000

### 3. Update firebase.json
```json
{
  "functions": {
    "source": "functions",
    "ignore": [
      "node_modules",
      ".git",
      "firebase-debug.log",
      "firebase-debug.*.log"
    ]
  },
  "database": {
    "rules": "database.rules.json"
  },
  "storage": {
    "rules": "storage.rules"
  },
  "emulators": {
    "auth": {
      "port": 9099
    },
    "functions": {
      "port": 5001
    },
    "database": {
      "port": 9000
    },
    "storage": {
      "port": 9199
    },
    "ui": {
      "enabled": true,
      "port": 4000
    },
    "singleProjectMode": true
  }
}
```

### 4. Create Environment Configuration
```bash
# Create local environment variables file
cd functions
echo "# Local environment variables for testing" > .env.local

# Add your test environment variables
echo "PROJECT_ID=your-test-project" >> .env.local
echo "GCLOUD_PROJECT=your-test-project" >> .env.local
```

### 5. Install Dependencies
```bash
cd functions
npm install
```

## Running the Emulators

### Start All Emulators
```bash
# From project root
firebase emulators:start
```

### Start Specific Emulators Only
```bash
# Only functions and database
firebase emulators:start --only functions,database

# With data import from previous session
firebase emulators:start --import=./emulator-data

# Export data before stopping
firebase emulators:export ./emulator-data
```

### Access Emulator UI
Open browser to: http://localhost:4000

## Testing JavaScript Functions

### HTTP Functions (submitAgent, beginPaperTrading, stopPaperTrading, getLeaderboard)

```bash
# First, create a test user and get a valid ID token
# You can do this via the Emulator UI at http://localhost:4000
# Or use the test script which creates users automatically

# Test submitAgent endpoint (requires valid ID token)
# Supports multiple file uploads
curl -X POST http://localhost:5001/YOUR_PROJECT/us-central1/submitAgent \
  -H "Authorization: Bearer YOUR_VALID_ID_TOKEN" \
  -F "files=@strategy.py" \
  -F "files=@utils.py"

# Test beginPaperTrading (requires valid ID token)
curl -X POST http://localhost:5001/YOUR_PROJECT/us-central1/beginPaperTrading \
  -H "Authorization: Bearer YOUR_VALID_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "test-agent-123"}'

# Test getLeaderboard (no auth required)
curl http://localhost:5001/YOUR_PROJECT/us-central1/getLeaderboard?timeframe=weekly
```

### Storage-Triggered Function (updateAgentMetadata)
The storage trigger will automatically fire when you upload files to the emulated storage bucket:

```javascript
// Use Firebase Admin SDK to upload to emulated storage
const admin = require('firebase-admin');
admin.initializeApp();

const bucket = admin.storage().bucket();
await bucket.file('agents/USER_ID/AGENT_ID/strategy.py').save(fileBuffer);
```

## Working Around Python Function Limitations

Since createAccount and fundAccount are Python functions that can't be emulated, you have options:

### Option 1: Mock Python Endpoints Locally
Create temporary JavaScript mock functions for local testing:

```javascript
// functions/mocks/alpacaMocks.js (for local testing only)
exports.createAccountMock = functions.https.onRequest((req, res) => {
  // Mock Alpaca account creation
  res.json({
    success: true,
    accountId: 'MOCK_ACCOUNT_' + Date.now(),
    message: 'Mock account created for local testing'
  });
});

exports.fundAccountMock = functions.https.onRequest((req, res) => {
  // Mock funding operation
  res.json({
    success: true,
    balance: 100000,
    message: 'Mock account funded for local testing'
  });
});
```

### Option 2: Use Python Functions Framework
Test Python functions separately:

```bash
# Install Python functions framework
pip install functions-framework

# Run Python function locally (separate terminal)
cd functions
functions-framework --target createAccount --port 8080
```

### Option 3: Deploy Python Functions to Staging
Deploy only Python functions to a staging environment:

```bash
firebase deploy --only functions:createAccount,functions:fundAccount
```

## Authentication in Emulator

The Authentication emulator provides full authentication functionality:

1. **Create test users via Emulator UI:**
   - Visit http://localhost:4000 → Authentication tab
   - Click "Add user" to create test users manually

2. **Create users programmatically:**
```javascript
// Create a test user
const testUser = await admin.auth().createUser({
    uid: 'test-user-123',
    email: 'test@example.com',
    emailVerified: true,
    displayName: 'Test User'
});

// Generate a custom token
const customToken = await admin.auth().createCustomToken(testUser.uid);

// Exchange for ID token (normally done client-side)
const response = await fetch(
    'http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key',
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token: customToken,
            returnSecureToken: true
        })
    }
);
const { idToken } = await response.json();
```

3. **Token verification works identically to production:**
   - The `admin.auth().verifyIdToken()` method works seamlessly
   - When `FIREBASE_AUTH_EMULATOR_HOST` is set, it automatically uses the emulator
   - No code changes needed between emulator and production

## Database Emulator

The Realtime Database emulator starts with empty data. You can:

1. **Import seed data:**
```bash
firebase emulators:start --import=./seed-data
```

2. **Manually add data via UI:**
Visit http://localhost:4000 → Realtime Database tab

3. **Programmatically seed data:**
```javascript
// In a setup script
const admin = require('firebase-admin');
admin.database().ref('users/test-user').set({
  agents: { /* test data */ }
});
```

## BigQuery/Leaderboard Testing

Since BigQuery isn't emulated, getLeaderboard will catch errors and return empty results. This is expected behavior in local testing.

## Debugging Tips

1. **View logs in Emulator UI:** http://localhost:4000/logs
2. **Enable verbose logging:**
   ```bash
   firebase emulators:start --debug
   ```
3. **Check function URLs:** Look for the exact URLs in console output
4. **Verify emulator connections:** Check the Emulator UI to see active connections

## Common Issues

### Issue: "Cannot find module" errors
**Solution:** Ensure you've run `npm install` in the functions directory

### Issue: Storage triggers not firing
**Solution:** Check that file paths match the pattern expected by updateAgentMetadata

### Issue: Authentication failures
**Solution:** Ensure you've created a test user and obtained a valid ID token. Check that FIREBASE_AUTH_EMULATOR_HOST is set to 'localhost:9099'

### Issue: Database permission denied
**Solution:** Emulator uses security rules from database.rules.json - check rules or disable for testing

## CI/CD Integration

For automated testing:

```bash
# Run tests with emulators
firebase emulators:exec --only functions,database "npm test"

# Or in package.json scripts
"test:emulators": "firebase emulators:exec --only functions,database 'npm test'"
```

## Production vs Emulator Detection

In your functions, detect emulator environment:

```javascript
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

if (isEmulator) {
  console.log('Running in emulator mode');
  // Use test configuration
} else {
  // Use production configuration
}
```

## Next Steps

1. Start emulators: `firebase emulators:start`
2. Visit UI: http://localhost:4000
3. Test JavaScript functions with curl or your frontend
4. For Python functions, use one of the workaround options above
5. Export test data before stopping: `firebase emulators:export ./emulator-data`