# Multi-Language Firebase Functions Setup

This project supports both JavaScript and Python Firebase Functions deployed together with a single command.

## Project Structure

```
The Farm Mark II/
├── firebase.json            # Multi-codebase configuration
├── functions/               # JavaScript functions (existing)
│   ├── index.js
│   ├── submitAgent.js       # JS: Agent submission HTTP endpoint
│   ├── updateAgentMetadata.js # JS: Storage trigger for backtesting
│   ├── package.json
│   └── utils/
└── python-functions/        # Python functions (new)
    ├── main.py              # Python function definitions
    ├── requirements.txt     # Python dependencies
    └── venv/                # Virtual environment (auto-created)
```

## Configuration (firebase.json)

The project uses Firebase's multiple codebases feature to support both languages:

```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "javascript-functions",
      "runtime": "nodejs20"
    },
    {
      "source": "python-functions",
      "codebase": "python-functions",
      "runtime": "python312"
    }
  ]
}
```

## Available Functions

### JavaScript Functions
- `submitAgent` - HTTP endpoint for uploading trading strategies
- `updateAgentMetadata` - Storage trigger for processing uploads and starting backtests

### Python Functions
- `createAccount` - HTTP endpoint for creating Alpaca paper trading accounts
- `fundAccount` - HTTP endpoint for funding Alpaca accounts with $25,000

## Deployment Commands

### Deploy Everything (JS + Python)
```bash
firebase deploy
```

### Deploy All Functions Only
```bash
firebase deploy --only functions
```

### Deploy Specific Codebase
```bash
# JavaScript functions only
firebase deploy --only functions:javascript-functions

# Python functions only
firebase deploy --only functions:python-functions
```

### Deploy Specific Function
```bash
# Deploy single JavaScript function
firebase deploy --only functions:javascript-functions:submitAgent

# Deploy single Python function
firebase deploy --only functions:python-functions:analyze_strategy
```

## Setting Up Python Functions

### 1. Initialize Python Environment
```bash
cd python-functions
python3.12 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 2. Add New Python Functions
Create a new Python file in `python-functions/` directory (e.g., `your_function.py`), then import it in `main.py`:

```python
# In your_function.py
from firebase_functions import https_fn

@https_fn.on_request(region="us-central1")
def yourNewFunction(req: https_fn.Request) -> https_fn.Response:
    # Your function logic here
    return https_fn.Response("Hello from Python!")

# In main.py
from your_function import yourNewFunction
```

### 3. Add Dependencies
```bash
cd python-functions
source venv/bin/activate
pip install your-package
pip freeze > requirements.txt
```

## Adding More Functions from Other Repos

To add functions from your other repository:

### For JavaScript Functions
1. Copy the function files to `functions/` directory
2. Add exports in `functions/index.js`:
   ```javascript
   exports.newFunction = require('./newFunction').newFunction;
   ```

### For Python Functions
1. Copy Python files to `python-functions/` directory
2. Import in `python-functions/main.py` or add directly to the file
3. Update `requirements.txt` with any new dependencies

## Function URLs

After deployment, your functions will be available at:

### JavaScript Functions (Gen 2)
- `submitAgent`: https://submitagent-emedpldi5a-uc.a.run.app
- `updateAgentMetadata`: (Storage trigger, no URL)

### Python Functions (Gen 2)
- `createAccount`: https://createaccount-emedpldi5a-uc.a.run.app
- `fundAccount`: https://fundaccount-emedpldi5a-uc.a.run.app

## Benefits of Multi-Language Setup

1. **Best of Both Worlds**: Use JavaScript for web-related tasks and Python for data science/ML
2. **Team Flexibility**: Different teams can work in their preferred language
3. **Library Access**: Access to both npm and pip ecosystems
4. **Gradual Migration**: Move functions between languages as needed
5. **Single Deployment**: One command deploys everything

## Testing

### Test JavaScript Functions
```bash
cd functions
npm test
```

### Test Python Functions
```bash
cd python-functions
source venv/bin/activate
python -m pytest  # If using pytest
```

### Local Emulator
```bash
firebase emulators:start
```
Note: Python functions in the emulator require Docker to be installed and running.

## Monitoring

View logs for all functions:
```bash
firebase functions:log
```

Filter by codebase:
```bash
firebase functions:log --only javascript-functions
firebase functions:log --only python-functions
```

## Important Notes

1. **Node.js Version**: Updated to Node.js 20 (from deprecated Node.js 18)
2. **Python Version**: Using Python 3.12 (supports 3.10-3.13)
3. **Bucket Name**: Both JS and Python functions use the same Firebase Storage bucket
4. **Docker Required**: Python functions require Docker for local emulation
5. **Deployment Time**: First Python deployment may take longer due to environment setup
6. **Secrets**: Python functions require ALPACA_BROKER_API_KEY and ALPACA_BROKER_SECRET_KEY secrets

## Troubleshooting

### Python Functions Not Deploying
- Ensure Docker is installed and running (only needed for local emulation)
- Check `requirements.txt` is in the same directory as `main.py`
- Verify Python version compatibility (3.10-3.13)
- Ensure Firebase secrets are set: `firebase functions:secrets:set ALPACA_BROKER_API_KEY`

### Import Errors in Python
- Run `pip freeze > requirements.txt` after installing new packages
- Ensure virtual environment is activated when installing

### Multiple Codebases Not Working
- Update Firebase CLI: `npm install -g firebase-tools`
- Ensure CLI version is 10.7.1 or higher: `firebase --version`

## Next Steps

1. Test the Python functions locally
2. Deploy with `firebase deploy --only functions:python-functions`
3. Add your production Python functions from other repos
4. Monitor performance and adjust runtime configurations as needed