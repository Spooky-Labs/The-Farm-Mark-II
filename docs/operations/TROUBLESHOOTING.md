# Troubleshooting Guide

Common issues and solutions for The Farm Mark II platform.

## 🔍 Quick Diagnostics

```bash
# Run comprehensive system check
bash scripts/utilities/verify-system.sh

# Check specific components
gcloud functions list --region=us-central1
kubectl get pods -A
gcloud pubsub topics list
```

## 🚨 Common Issues

### Deployment Issues

#### Issue: Terraform Apply Fails

**Symptoms:**
```
Error: Error creating Dataset: googleapi: Error 403
```

**Causes:**
- Missing GCP permissions
- Billing not enabled
- API not enabled

**Solutions:**
```bash
# Enable required APIs
gcloud services enable \
  container.googleapis.com \
  cloudfunctions.googleapis.com \
  pubsub.googleapis.com \
  bigquery.googleapis.com \
  redis.googleapis.com

# Check billing
gcloud beta billing projects describe $PROJECT_ID

# Grant permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="user:YOUR_EMAIL" \
  --role="roles/owner"
```

#### Issue: Cloud Function Deployment Timeout

**Symptoms:**
```
ERROR: (gcloud.functions.deploy) Operation timed out
```

**Causes:**
- Large function package
- Network issues
- npm install failures

**Solutions:**
```bash
# Check function logs
gcloud functions logs read main-api --limit=50

# Try deploying with more memory
gcloud functions deploy main-api \
  --memory=1024MB \
  --timeout=540s

# Clean node_modules and retry
cd cloud-functions/main-api
rm -rf node_modules
npm install
gcloud functions deploy main-api ...
```

#### Issue: Kubernetes Pod Won't Start

**Symptoms:**
```
kubectl get pods
NAME                          READY   STATUS             RESTARTS
unified-ingester-xxx          0/1     ImagePullBackOff   5
```

**Causes:**
- Image not found
- Registry permissions
- Resource limits

**Solutions:**
```bash
# Check pod events
kubectl describe pod unified-ingester-xxx

# Check image exists
gcloud container images list

# Restart pod
kubectl delete pod unified-ingester-xxx

# Check resource limits
kubectl top nodes
kubectl top pods
```

### Runtime Issues

#### Issue: Market Data Not Flowing

**Symptoms:**
- No data in BigQuery `market_data` table
- Trading agents not receiving quotes
- Pub/Sub messages stuck

**Diagnosis:**
```bash
# Check unified-ingester logs
kubectl logs -f deployment/unified-ingester

# Check Pub/Sub subscriptions
gcloud pubsub subscriptions list

# Check BigQuery recent data
bq query --use_legacy_sql=false '
  SELECT timestamp, symbol, COUNT(*)
  FROM `PROJECT.market_data.market_data`
  WHERE DATE(timestamp) = CURRENT_DATE()
  GROUP BY timestamp, symbol
  ORDER BY timestamp DESC
  LIMIT 10
'
```

**Solutions:**

**Problem: WebSocket Connection Failing**
```bash
# Check Alpaca credentials
kubectl get secret alpaca-credentials -o yaml

# Restart ingester
kubectl rollout restart deployment/unified-ingester

# Check Alpaca API status
curl https://paper-api.alpaca.markets/v2/account \
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
  -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY"
```

**Problem: Pub/Sub Not Publishing**
```bash
# Check Pub/Sub permissions
gcloud pubsub topics get-iam-policy market-data-stocks

# Test manual publish
gcloud pubsub topics publish market-data-stocks \
  --message='{"test": "data"}'

# Check topic exists
gcloud pubsub topics list | grep market-data
```

#### Issue: Trading Agent Not Executing

**Symptoms:**
- Agent pod running but no trades
- No FMEL records in BigQuery
- Agent status stuck

**Diagnosis:**
```bash
# Check agent pod logs
kubectl logs -f statefulset/agent-user123-456

# Check FMEL records
bq query --use_legacy_sql=false '
  SELECT agent_id, decision_type, timestamp
  FROM `PROJECT.fmel_data.fmel_decisions`
  WHERE agent_id = "user123-456"
  ORDER BY timestamp DESC
  LIMIT 10
'

# Check Alpaca account
curl https://paper-api.alpaca.markets/v2/account \
  -H "APCA-API-KEY-ID: $AGENT_ALPACA_KEY" \
  -H "APCA-API-SECRET-KEY: $AGENT_ALPACA_SECRET"
```

**Solutions:**

**Problem: No Market Data Subscription**
```bash
# Check Pub/Sub subscription
kubectl exec -it agent-user123-456-0 -- python -c "
import os
from google.cloud import pubsub_v1

subscriber = pubsub_v1.SubscriberClient()
subscription_path = subscriber.subscription_path(
    os.environ['PROJECT_ID'],
    'agent-market-data-sub'
)
print(subscriber.get_subscription(subscription=subscription_path))
"
```

**Problem: Strategy Code Error**
```bash
# Check agent logs for Python errors
kubectl logs agent-user123-456-0 | grep -i "error\|exception\|traceback"

# Exec into pod and test strategy
kubectl exec -it agent-user123-456-0 -- bash
python /app/strategy.py
```

**Problem: Alpaca API Issues**
```bash
# Check Alpaca account status
kubectl exec -it agent-user123-456-0 -- python -c "
import os
from alpaca_trade_api.rest import REST

api = REST(
    key_id=os.environ['ALPACA_API_KEY'],
    secret_key=os.environ['ALPACA_SECRET_KEY'],
    base_url=os.environ.get('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets')
)
account = api.get_account()
print(f'Account status: {account.status}')
print(f'Buying power: ${account.buying_power}')
"
```

#### Issue: API Gateway Returning Errors

**Symptoms:**
```
HTTP 500 Internal Server Error
HTTP 503 Service Unavailable
```

**Diagnosis:**
```bash
# Check function logs
gcloud functions logs read main-api \
  --region=us-central1 \
  --limit=100 \
  --format="value(textPayload)"

# Check function health
curl https://REGION-PROJECT.cloudfunctions.net/main-api/health

# Check Redis connection
gcloud redis instances describe farm-redis --region=us-central1
```

**Solutions:**

**Problem: Redis Connection Timeout**
```bash
# Check Redis status
gcloud redis instances describe farm-redis --region=us-central1

# Check VPC connector
gcloud compute networks vpc-access connectors list --region=us-central1

# Restart function to reset connections
gcloud functions deploy main-api --region=us-central1 --no-source
```

**Problem: Firebase Auth Failing**
```bash
# Check Firebase project
firebase projects:list

# Verify service account
gcloud iam service-accounts list

# Test authentication
curl https://REGION-PROJECT.cloudfunctions.net/main-api/api/agents/list \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -v
```

### Performance Issues

#### Issue: High Latency

**Symptoms:**
- API responses >1s
- Leaderboard slow to load
- Agent submissions timing out

**Diagnosis:**
```bash
# Check function metrics
gcloud functions describe main-api \
  --region=us-central1 \
  --format="value(status)"

# Check Redis latency
gcloud redis instances describe farm-redis \
  --region=us-central1 \
  --format="value(currentLocationId, host, port)"

# Test Redis connection
redis-cli -h REDIS_HOST -p REDIS_PORT ping
```

**Solutions:**

**Problem: Cold Starts**
```bash
# Increase min instances
gcloud functions deploy main-api \
  --min-instances=1 \
  --region=us-central1

# Or use Cloud Run (faster cold starts)
```

**Problem: BigQuery Query Timeout**
```sql
-- Add query optimization
SELECT agent_id, total_return
FROM `PROJECT.analytics.agent_performance`
WHERE DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
ORDER BY total_return DESC
LIMIT 100
```

**Problem: Redis Cache Miss**
```javascript
// Check cache TTL
const ttl = await redis.ttl('leaderboard:top100');
console.log(`TTL: ${ttl} seconds`);

// Increase cache duration
await redis.setex('leaderboard:top100', 300, JSON.stringify(data));
```

#### Issue: High Costs

**Symptoms:**
- Unexpected GCP bill
- BigQuery costs increasing
- Pub/Sub message volume high

**Diagnosis:**
```bash
# Check BigQuery costs
bq ls --format=prettyjson | jq '.[] | .id, .location, .numBytes'

# Check Pub/Sub metrics
gcloud pubsub subscriptions describe agent-market-data-sub \
  --format="value(messageRetentionDuration, expirationPolicy)"

# Check function invocations
gcloud functions describe main-api \
  --region=us-central1 \
  --format="value(httpsTrigger.url)"
```

**Solutions:**

**Problem: BigQuery Storage Costs**
```bash
# Set table expiration
bq update --expiration 2592000 \
  PROJECT:market_data.market_data  # 30 days

# Check partition pruning
bq query --dry_run --use_legacy_sql=false '
  SELECT COUNT(*)
  FROM `PROJECT.market_data.market_data`
  WHERE DATE(timestamp) = CURRENT_DATE()
'
```

**Problem: Excessive Pub/Sub Messages**
```bash
# Check message rate
gcloud monitoring time-series list \
  --filter='metric.type="pubsub.googleapis.com/subscription/num_outstanding_messages"' \
  --format=json

# Reduce ingester frequency
kubectl edit deployment unified-ingester
# Adjust POLL_INTERVAL_SECONDS
```

## 🔧 Debugging Tools

### Cloud Logging Queries

```sql
-- Find errors in last hour
resource.type="cloud_function"
resource.labels.function_name="main-api"
severity>=ERROR
timestamp>="2025-09-30T10:00:00Z"

-- Find slow queries
resource.type="cloud_function"
jsonPayload.latency>1000
```

### Kubernetes Debugging

```bash
# Get pod resource usage
kubectl top pods -A

# Check pod events
kubectl get events --sort-by=.metadata.creationTimestamp

# Debug networking
kubectl run tmp-shell --rm -i --tty --image nicolaka/netshoot -- /bin/bash
```

### BigQuery Debugging

```sql
-- Check recent insertions
SELECT
  table_name,
  TIMESTAMP_MILLIS(creation_time) as created,
  row_count,
  size_bytes
FROM `PROJECT.market_data.__TABLES__`
WHERE table_name = 'market_data';

-- Find slow queries
SELECT
  query,
  total_bytes_processed,
  total_slot_ms,
  creation_time
FROM `region-us.INFORMATION_SCHEMA.JOBS_BY_PROJECT`
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
ORDER BY total_slot_ms DESC
LIMIT 10;
```

## 📞 Getting Help

### Before Asking for Help

1. Run system verification: `bash scripts/utilities/verify-system.sh`
2. Collect logs from failed component
3. Check [OPERATIONS.md](./OPERATIONS.md) for procedures
4. Review [MEMORY.md](../reference/MEMORY.md) for known issues

### Include in Support Request

- Output of `verify-system.sh`
- Relevant log snippets
- Steps to reproduce
- Expected vs actual behavior
- Environment (dev/staging/prod)

## 📚 Additional Resources

- [Operations Guide](./OPERATIONS.md)
- [Architecture Documentation](../architecture/ARCHITECTURE.md)
- [GCP Troubleshooting](https://cloud.google.com/docs/troubleshooting)
- [Kubernetes Debugging](https://kubernetes.io/docs/tasks/debug/)

---

**Last Updated:** 2025-09-30