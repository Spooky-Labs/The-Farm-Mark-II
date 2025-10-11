# Spooky Labs Trading Platform

Simple Firebase Functions implementation for algorithmic trading with backtesting and paper trading.

## Architecture

```
functions/
├── index.js                 # Entry point - imports all functions
├── submitAgent.js           # Upload trading strategies
├── beginPaperTrading.js     # Start paper trading
├── stopPaperTrading.js      # Stop paper trading
├── getLeaderboard.js        # Public rankings
├── updateAgentMetadata.js   # Storage trigger for backtesting
├── multipartFileUpload.js   # Shared utility for file uploads
├── main.py                  # Python functions (Alpaca integration)
│   ├── createAccount        # Create Alpaca account
│   └── fundAccount          # Fund with virtual money
├── package.json             # Node dependencies
└── requirements.txt         # Python dependencies
```

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.9+
- Firebase CLI
- Google Cloud Project with billing enabled

### Setup

1. **Install Firebase CLI**
   ```bash
   npm install -g firebase-tools
   firebase login
   ```

2. **Configure project**
   ```bash
   # Set your project ID
   firebase use YOUR_PROJECT_ID

   # Or create .firebaserc manually
   echo '{"projects":{"default":"YOUR_PROJECT_ID"}}' > .firebaserc
   ```

3. **Install dependencies**
   ```bash
   cd functions
   npm install
   pip install -r requirements.txt
   ```

4. **Set environment variables**
   ```bash
   firebase functions:config:set \
     alpaca.api_key="YOUR_ALPACA_API_KEY" \
     alpaca.secret_key="YOUR_ALPACA_SECRET_KEY" \
     alpaca.broker_api_key="YOUR_BROKER_API_KEY" \
     alpaca.broker_secret="YOUR_BROKER_SECRET"
   ```

### Deploy

```bash
# Deploy everything
firebase deploy

# Or deploy only functions
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:submitAgent
```

## Endpoints

After deployment, your functions will be available at:

```
https://us-central1-PROJECT_ID.cloudfunctions.net/submitAgent
https://us-central1-PROJECT_ID.cloudfunctions.net/createAccount
https://us-central1-PROJECT_ID.cloudfunctions.net/fundAccount
https://us-central1-PROJECT_ID.cloudfunctions.net/beginPaperTrading
https://us-central1-PROJECT_ID.cloudfunctions.net/stopPaperTrading
https://us-central1-PROJECT_ID.cloudfunctions.net/getLeaderboard
```

## Storage Buckets

The platform uses these Cloud Storage buckets:

- `PROJECT_ID-agent-code` - Agent Python files
- `PROJECT_ID-backtest-results` - Backtest output

## Database Structure

Firebase Realtime Database (maintains backward compatibility):

```
agents/
  {userId}/
    {agentId}/     # agentId uses Firebase push().key format
      - agentId
      - userId
      - timestamp
      - numberOfFiles
      - status
      - files[]
      - bucketName

users/
  {userId}/
    agents/
      {agentId}/   # Duplicate for user-centric queries
        - agentId
        - userId
        - timestamp
        - numberOfFiles
        - status
        - files[]
        - bucketName
        - backtestStatus
        - backtestResults
    accounts/
      {agentId}/
        - accountId
        - funded
        - balance

paperTradingSessions/
  {sessionId}/
    - agentId
    - userId
    - status
```

**Important Notes:**
- Agent IDs are generated using Firebase `push().key` for time-ordered uniqueness
- Agent data is stored in both `/agents/{userId}/{agentId}` and `/users/{userId}/agents/{agentId}` for backward compatibility
- Multiple Python files can be uploaded per agent
- File paths in Storage follow pattern: `agents/{userId}/{agentId}/{filename}`

## Code Organization

Each function is in its own file for better maintainability:

- **JavaScript Functions**: Each endpoint has its own `.js` file
- **Python Functions**: Both Alpaca functions in `main.py`
- **Shared Utilities**: `multipartFileUpload.js` handles file parsing
- **Entry Point**: `index.js` imports and exports all functions

This follows the same pattern as the original Cloud Functions repository, making the code easier to read, test, and maintain.

## Development

### Local Testing

```bash
# Start Firebase emulators
firebase emulators:start

# Test functions locally
firebase functions:shell
```

### Logs

```bash
# View function logs
firebase functions:log

# Follow logs
firebase functions:log --follow

# Filter by function
firebase functions:log --only submitAgent
```

## API Usage

### Submit Agent

```javascript
const formData = new FormData();
// Can upload multiple Python files
formData.append('files', strategyFile);
formData.append('files', utilsFile);

const response = await fetch('https://us-central1-PROJECT.cloudfunctions.net/submitAgent', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${idToken}`
  },
  body: formData
});

// Response format:
// {
//   success: true,
//   agentId: "-NjKlMnOpQrStUvWxYz",  // Firebase push key
//   timestamp: 1699123456789,
//   userId: "user123",
//   numberOfFiles: 2,
//   bucketName: "PROJECT-agent-code"
// }
```

### Create Account

```javascript
await fetch('https://us-central1-PROJECT.cloudfunctions.net/createAccount', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ agentId })
});
```

### Get Leaderboard (Public)

```javascript
await fetch('https://us-central1-PROJECT.cloudfunctions.net/getLeaderboard?timeframe=weekly');
```

## Cost

Typical monthly costs with Firebase Functions:

- **Functions**: ~$5-10 (first 2M invocations free)
- **Database**: ~$5 (1GB storage, 10GB bandwidth free)
- **Storage**: ~$5 (5GB storage, 1GB bandwidth free)
- **Total**: ~$15-25/month for moderate usage

## Security

- All functions (except leaderboard) require Firebase Authentication
- Database rules enforce user data isolation
- Storage rules prevent unauthorized access
- Alpaca API keys stored in environment config

## License

Proprietary - Spooky Labs