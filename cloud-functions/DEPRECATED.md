# Cloud Functions Architecture Notes

## ✅ Active Cloud Functions

### 1. `api-gateway/` (Node.js)
**Primary unified API endpoint for all operations**

Routes:
- `/api/agents/*` - Agent CRUD operations
- `/api/backtest/*` - Backtest management
- `/api/broker/*` - Simplified broker operations (Node.js SDK)
- `/api/paper-trading/*` - Paper trading control + proxies to Python functions
- `/api/leaderboard` - Redis-backed leaderboards
- `/api/fmel/*` - FMEL analytics

### 2. `create-account/` (Python)
**Alpaca Broker API account creation**

- **Why Python?** Alpaca Broker API only works properly with Python SDK
- **Endpoint:** `https://{region}-{project}.cloudfunctions.net/create-account`
- **Proxy:** Available via `POST /api/paper-trading/create-account`
- **Alternative:** `POST /api/broker/create-account` (simplified Node.js version for basic paper trading)

### 3. `fund-account/` (Python)
**Alpaca Broker API account funding**

- **Why Python?** Alpaca Broker API only works properly with Python SDK
- **Endpoint:** `https://{region}-{project}.cloudfunctions.net/fund-account`
- **Proxy:** Available via `POST /api/paper-trading/fund-account`
- **Alternative:** `POST /api/broker/fund-account` (simplified Node.js version for basic paper trading)

## Architecture Design

### Why Both Python + Node.js?

**Python Functions (create-account, fund-account):**
- Use Alpaca's official `alpaca-py` Broker API SDK
- Full broker features (real account creation, ACH transfers, etc.)
- Required for production use with real Alpaca brokerage accounts

**Node.js Broker Routes (`/api/broker/*`):**
- Simplified implementation for Milestone 0 paper trading
- Doesn't require full Broker API functionality
- Faster for development/testing
- Uses `@alpacahq/alpaca-trade-api` for basic trading operations

### Recommended Usage

**For Milestone 0 (Paper Trading Only):**
```javascript
// Option 1: Use simplified Node.js routes (faster, simpler)
POST /api/broker/create-account
POST /api/broker/fund-account

// Option 2: Use Python functions via proxy (full Broker API)
POST /api/paper-trading/create-account
POST /api/paper-trading/fund-account
```

**For Production (Real Accounts):**
```javascript
// MUST use Python functions for real broker operations
POST /api/paper-trading/create-account  // Proxies to Python
POST /api/paper-trading/fund-account    // Proxies to Python
```

## Deployment

Deploy all three Cloud Functions:

```bash
# 1. API Gateway (Node.js)
cd cloud-functions/api-gateway
gcloud functions deploy api-gateway \
  --gen2 \
  --runtime=nodejs22 \
  --region=us-central1 \
  --source=. \
  --entry-point=api-gateway \
  --trigger-http \
  --allow-unauthenticated

# 2. Create Account (Python)
cd ../create-account
gcloud functions deploy create-account \
  --gen2 \
  --runtime=python311 \
  --region=us-central1 \
  --source=. \
  --entry-point=create_account \
  --trigger-http \
  --allow-unauthenticated

# 3. Fund Account (Python)
cd ../fund-account
gcloud functions deploy fund-account \
  --gen2 \
  --runtime=python311 \
  --region=us-central1 \
  --source=. \
  --entry-point=fund_account \
  --trigger-http \
  --allow-unauthenticated
```

## Environment Variables

All functions need:
```bash
ALPACA_API_KEY=your_key
ALPACA_SECRET_KEY=your_secret
ALPACA_SANDBOX=true
PROJECT_ID=your-gcp-project
```

---

**Last Updated:** 2025-09-29
**Status:** Hybrid architecture with Python + Node.js for optimal functionality