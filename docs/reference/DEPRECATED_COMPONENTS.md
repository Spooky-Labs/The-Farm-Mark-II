# Deprecated Components

This document tracks deprecated components across the entire platform.

---

## Cloud Functions

### ✅ Active Cloud Functions

#### 1. `main-api/` (Node.js)
**Primary unified API endpoint for all operations**

Routes:
- `/api/agents/*` - Agent CRUD operations
- `/api/backtest/*` - Backtest management
- `/api/broker/*` - Simplified broker operations (Node.js SDK)
- `/api/paper-trading/*` - Paper trading control + proxies to Python functions
- `/api/leaderboard` - Redis-backed leaderboards
- `/api/fmel/*` - FMEL analytics

#### 2. `create-account/` (Python)
**Alpaca Broker API account creation**

- **Why Python?** Alpaca Broker API only works properly with Python SDK
- **Endpoint:** `https://{region}-{project}.cloudfunctions.net/create-account`
- **Proxy:** Available via `POST /api/paper-trading/create-account`
- **Alternative:** `POST /api/broker/create-account` (simplified Node.js version for basic paper trading)

#### 3. `fund-account/` (Python)
**Alpaca Broker API account funding**

- **Why Python?** Alpaca Broker API only works properly with Python SDK
- **Endpoint:** `https://{region}-{project}.cloudfunctions.net/fund-account`
- **Proxy:** Available via `POST /api/paper-trading/fund-account`
- **Alternative:** `POST /api/broker/fund-account` (simplified Node.js version for basic paper trading)

### Architecture Design

**Why Both Python + Node.js?**

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

---

## Data Ingesters

### ❌ Deprecated: `alpaca-websocket-streamer/`

**Reason:** Redundant - functionality is fully covered by `unified-ingester/`

**What it did:**
- WebSocket streaming from Alpaca (stocks only)
- Published to Pub/Sub
- Prometheus metrics

**Why deprecated:**
- `unified-ingester/` already handles:
  - ✅ Stocks WebSocket streaming (same functionality)
  - ✅ Crypto WebSocket streaming (additional)
  - ✅ News API polling (additional)
  - ✅ Better configuration (YAML-based)
  - ✅ More maintainable (single codebase)

### ✅ Current: `unified-ingester/`

**Keep and use this one!**

**Features:**
- Alpaca stocks + crypto WebSocket streaming
- Alpaca news API polling
- Configurable via `config.milestone0.yaml`
- Pub/Sub publishing
- Deploy to GKE (24/7 streaming)

**Deployment:**
```bash
# Deploy via Kubernetes
kubectl apply -f kubernetes/data-ingesters/unified-ingester/
```

### Migration

No migration needed - just use `unified-ingester/` for all data ingestion.

### Cleanup

This directory can be **deleted after verification:**
- `data-ingesters/alpaca-websocket-streamer/` ❌

Keep only:
- `data-ingesters/unified-ingester/` ✅

---

## Summary

| Component | Status | Replacement | Action |
|-----------|--------|-------------|--------|
| `alpaca-websocket-streamer/` | ❌ Deprecated | `unified-ingester/` | Can delete |
| Cloud Functions architecture | ✅ Active | N/A | Keep all 3 functions |

---

**Last Updated:** 2025-09-30
**Status:** Actively maintained