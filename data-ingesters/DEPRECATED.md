# Deprecated Data Ingesters

## ❌ Deprecated: `alpaca-websocket-streamer/`

**Reason:** Redundant - functionality is fully covered by `unified-ingester/`

### What it did:
- WebSocket streaming from Alpaca (stocks only)
- Published to Pub/Sub
- Prometheus metrics

### Why deprecated:
- `unified-ingester/` already handles:
  - ✅ Stocks WebSocket streaming (same functionality)
  - ✅ Crypto WebSocket streaming (additional)
  - ✅ News API polling (additional)
  - ✅ Better configuration (YAML-based)
  - ✅ More maintainable (single codebase)

## ✅ Current: `unified-ingester/`

**Keep and use this one!**

### Features:
- Alpaca stocks + crypto WebSocket streaming
- Alpaca news API polling
- Configurable via `config.milestone0.yaml`
- Pub/Sub publishing
- Deploy to Cloud Run (cheaper than GKE)

### Deployment:
```bash
# Deploy to Cloud Run
gcloud run deploy unified-market-data-ingester \
  --source=data-ingesters/unified-ingester \
  --region=us-central1 \
  --set-env-vars="PROJECT_ID=...,ALPACA_API_KEY=..."
```

## Migration

No migration needed - just use `unified-ingester/` for all data ingestion.

## Cleanup

This directory can be **deleted after verification:**
- `data-ingesters/alpaca-websocket-streamer/` ❌

Keep only:
- `data-ingesters/unified-ingester/` ✅

---

**Date:** 2025-09-29
**Status:** Consolidated into unified-ingester