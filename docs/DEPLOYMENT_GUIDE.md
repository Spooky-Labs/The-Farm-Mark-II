# The Farm Mark II - Comprehensive Deployment Guide

## Overview

This guide provides complete instructions for deploying The Farm Mark II algorithmic trading platform using the new API Gateway + Cloud Run microservices architecture.

## Prerequisites

### Required Tools

```bash
# Check if tools are installed
gcloud version           # Google Cloud SDK
terraform version        # Terraform 1.0+
docker version          # Docker 20.10+
kubectl version         # Kubernetes CLI
firebase --version      # Firebase CLI
```

### GCP Project Setup

```bash
# Set your project ID
export PROJECT_ID="your-project-id"
export REGION="us-central1"

# Set the project
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
    apigateway.googleapis.com \
    servicecontrol.googleapis.com \
    servicemanagement.googleapis.com \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    firestore.googleapis.com \
    bigquery.googleapis.com \
    storage.googleapis.com \
    pubsub.googleapis.com \
    cloudscheduler.googleapis.com \
    container.googleapis.com \
    redis.googleapis.com \
    compute.googleapis.com \
    servicenetworking.googleapis.com \
    vpcaccess.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com
```

## Phase 1: Infrastructure Deployment

### Step 1.1: Terraform State Bucket

```bash
# Create state bucket
gsutil mb -p $PROJECT_ID -l $REGION gs://${PROJECT_ID}-terraform-state

# Enable versioning
gsutil versioning set on gs://${PROJECT_ID}-terraform-state
```

### Step 1.2: Deploy Infrastructure

```bash
cd terraform-api-gateway

# Initialize Terraform
terraform init -backend-config="bucket=${PROJECT_ID}-terraform-state"

# Review the plan
terraform plan -var="project_id=$PROJECT_ID" -var="region=$REGION"

# Apply infrastructure
terraform apply -var="project_id=$PROJECT_ID" -var="region=$REGION" -auto-approve

# Save outputs for later use
terraform output -json > ../terraform-outputs.json
```

### Step 1.3: Verify Infrastructure

```bash
# Check GKE cluster
gcloud container clusters list --region=$REGION

# Check Redis instance
gcloud redis instances list --region=$REGION

# Check BigQuery datasets
bq ls --project_id=$PROJECT_ID

# Check Pub/Sub topics
gcloud pubsub topics list
```

## Phase 2: Service Account Setup

### Step 2.1: Create Service Accounts

```bash
# Create service accounts for each Cloud Run service
for SERVICE in agents-service backtest-service paper-trading-service \
               leaderboard-service broker-service fmel-service; do
    gcloud iam service-accounts create $SERVICE \
        --display-name="$SERVICE Cloud Run Service Account"
done

# Create API Gateway service account
gcloud iam service-accounts create api-gateway \
    --display-name="API Gateway Service Account"
```

### Step 2.2: Grant Permissions

```bash
# Grant necessary roles to service accounts
# agents-service
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:agents-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/storage.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:agents-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/datastore.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:agents-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/pubsub.publisher"

# backtest-service
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:backtest-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:backtest-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/datastore.user"

# paper-trading-service
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:paper-trading-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/container.developer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:paper-trading-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/datastore.user"

# leaderboard-service
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:leaderboard-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:leaderboard-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/redis.editor"

# broker-service
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:broker-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/datastore.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:broker-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

# fmel-service
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:fmel-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:fmel-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/datastore.viewer"

# API Gateway service account
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:api-gateway@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.invoker"
```

## Phase 3: Container Registry Setup

### Step 3.1: Create Artifact Registry

```bash
# Create Docker repository
gcloud artifacts repositories create cloud-run-source-deploy \
    --repository-format=docker \
    --location=$REGION \
    --description="Docker repository for Cloud Run services"

# Configure Docker authentication
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

## Phase 4: Build and Deploy Services

### Step 4.1: Build Docker Images

```bash
# Build all service images
SERVICES=(
    "agents-service"
    "backtest-service"
    "paper-trading-service"
    "leaderboard-service"
    "broker-service"
    "fmel-service"
)

for SERVICE in "${SERVICES[@]}"; do
    echo "Building $SERVICE..."
    cd cloud-run-services/$SERVICE

    # Build image
    docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE}:latest .

    # Push to registry
    docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE}:latest

    cd ../..
done
```

### Step 4.2: Deploy Cloud Run Services

```bash
# Get Redis host from Terraform output
REDIS_HOST=$(terraform -chdir=terraform-api-gateway output -raw redis_host)

# Deploy each service
for SERVICE in "${SERVICES[@]}"; do
    echo "Deploying $SERVICE..."

    # Service-specific environment variables
    ENV_VARS="PROJECT_ID=$PROJECT_ID,REGION=$REGION"

    if [ "$SERVICE" = "leaderboard-service" ]; then
        ENV_VARS="$ENV_VARS,REDIS_HOST=$REDIS_HOST"
    fi

    gcloud run deploy $SERVICE \
        --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE}:latest \
        --region $REGION \
        --platform managed \
        --no-allow-unauthenticated \
        --service-account ${SERVICE}@${PROJECT_ID}.iam.gserviceaccount.com \
        --set-env-vars "$ENV_VARS" \
        --max-instances 100 \
        --min-instances 0 \
        --memory 1Gi \
        --cpu 1 \
        --timeout 300
done
```

## Phase 5: API Gateway Deployment

### Step 5.1: Update OpenAPI Specification

```bash
cd api-gateway

# Update with your project values
sed -i.bak "s/YOUR_PROJECT_ID/${PROJECT_ID}/g" openapi-spec.yaml
sed -i.bak "s/YOUR_REGION/${REGION}/g" openapi-spec.yaml

# Get Cloud Run service URLs and update spec
for SERVICE in "${SERVICES[@]}"; do
    SERVICE_URL=$(gcloud run services describe $SERVICE \
        --region=$REGION \
        --format="value(status.url)")

    sed -i.bak "s|https://${SERVICE}-.*\.run\.app|${SERVICE_URL}|g" openapi-spec.yaml
done
```

### Step 5.2: Deploy API Gateway

```bash
# Create API
gcloud api-gateway apis create farm-api \
    --project=$PROJECT_ID

# Create API config
gcloud api-gateway api-configs create farm-api-config \
    --api=farm-api \
    --openapi-spec=openapi-spec.yaml \
    --project=$PROJECT_ID \
    --backend-auth-service-account=api-gateway@${PROJECT_ID}.iam.gserviceaccount.com

# Deploy gateway
gcloud api-gateway gateways create farm-gateway \
    --api=farm-api \
    --api-config=farm-api-config \
    --location=$REGION \
    --project=$PROJECT_ID

# Get Gateway URL
GATEWAY_URL=$(gcloud api-gateway gateways describe farm-gateway \
    --location=$REGION \
    --format="value(defaultHostname)")

echo "API Gateway URL: https://$GATEWAY_URL"
cd ..
```

## Phase 6: Kubernetes Resources

### Step 6.1: Configure kubectl

```bash
# Get cluster credentials
gcloud container clusters get-credentials farm-cluster \
    --region=$REGION \
    --project=$PROJECT_ID
```

### Step 6.2: Create Namespaces and Secrets

```bash
# Create namespaces
kubectl create namespace paper-trading
kubectl create namespace data-ingestion
kubectl create namespace backtesting

# Create Alpaca secrets (update with real values)
kubectl create secret generic alpaca-credentials \
    --from-literal=api-key="YOUR_ALPACA_API_KEY" \
    --from-literal=secret-key="YOUR_ALPACA_SECRET_KEY" \
    --namespace=paper-trading

kubectl create secret generic alpaca-credentials \
    --from-literal=api-key="YOUR_ALPACA_API_KEY" \
    --from-literal=secret-key="YOUR_ALPACA_SECRET_KEY" \
    --namespace=data-ingestion
```

### Step 6.3: Deploy Kubernetes Manifests

```bash
# Apply all Kubernetes configurations
kubectl apply -f kubernetes/
```

## Phase 7: Container Images for K8s Workloads

### Step 7.1: Build and Push Trading Container Images

```bash
# Build backtest-runner
cd containers/backtest-runner
docker build -t gcr.io/$PROJECT_ID/backtest-runner:latest .
docker push gcr.io/$PROJECT_ID/backtest-runner:latest
cd ../..

# Build paper-trader
cd containers/paper-trader
docker build -t gcr.io/$PROJECT_ID/paper-trader:latest .
docker push gcr.io/$PROJECT_ID/paper-trader:latest
cd ../..

# Build data-ingester
cd data-ingesters/unified-ingester
docker build -t gcr.io/$PROJECT_ID/data-ingester:latest .
docker push gcr.io/$PROJECT_ID/data-ingester:latest
cd ../..
```

## Phase 8: BigQuery Setup

### Step 8.1: Create Tables

```bash
# Create market data table
bq mk --table \
    --schema schemas/bigquery/market_data_ohlcv.json \
    --time_partitioning_field timestamp \
    --clustering_fields symbol \
    ${PROJECT_ID}:market_data.ohlcv

# Create analytics table
bq mk --table \
    --schema schemas/bigquery/agent_performance.json \
    ${PROJECT_ID}:analytics.agent_performance

# Create FMEL decisions table
bq mk --table \
    --schema schemas/bigquery/trading_decisions.json \
    --time_partitioning_field timestamp \
    --clustering_fields agent_id \
    ${PROJECT_ID}:fmel.trading_decisions
```

## Phase 9: Cloud Scheduler Setup

### Step 9.1: Create Scheduled Jobs

```bash
# Market data ingestion (every 5 minutes)
gcloud scheduler jobs create pubsub market-data-ingestion \
    --schedule="*/5 * * * *" \
    --topic=market-data-ingestion \
    --message-body="{}" \
    --location=$REGION

# Leaderboard update (hourly)
gcloud scheduler jobs create pubsub leaderboard-update \
    --schedule="0 * * * *" \
    --topic=leaderboard-update \
    --message-body="{}" \
    --location=$REGION

# Daily analytics aggregation
gcloud scheduler jobs create pubsub analytics-aggregation \
    --schedule="0 2 * * *" \
    --topic=analytics-aggregation \
    --message-body="{}" \
    --location=$REGION
```

## Phase 10: Secrets Management

### Step 10.1: Create Secrets

```bash
# Alpaca API credentials
echo -n "YOUR_ALPACA_API_KEY" | gcloud secrets create alpaca-api-key --data-file=-
echo -n "YOUR_ALPACA_SECRET_KEY" | gcloud secrets create alpaca-secret-key --data-file=-

# Firebase configuration
echo -n "YOUR_FIREBASE_API_KEY" | gcloud secrets create firebase-api-key --data-file=-

# Internal API key for service-to-service communication
INTERNAL_KEY=$(openssl rand -hex 32)
echo -n "$INTERNAL_KEY" | gcloud secrets create internal-api-key --data-file=-
```

### Step 10.2: Grant Access to Secrets

```bash
# Grant broker-service access to Alpaca secrets
gcloud secrets add-iam-policy-binding alpaca-api-key \
    --member="serviceAccount:broker-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding alpaca-secret-key \
    --member="serviceAccount:broker-service@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

## Phase 11: Firebase Setup

### Step 11.1: Initialize Firebase

```bash
# Initialize Firebase project
firebase init

# Select:
# - Firestore
# - Authentication
# - Hosting (if needed)
```

### Step 11.2: Configure Authentication

```bash
# Enable authentication providers
firebase auth:import users.json --hash-algo=BCRYPT

# Set up JWT configuration
firebase auth:export jwt-config.json
```

## Phase 12: Data Upload

### Step 12.1: Upload Market Data

```bash
# Create storage bucket for market data
gsutil mb -p $PROJECT_ID -l $REGION gs://${PROJECT_ID}-market-data

# Upload CSV files
gsutil -m cp data/*.csv gs://${PROJECT_ID}-market-data/

# Set lifecycle policy for old data
cat > lifecycle.json << EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
        "condition": {"age": 30}
      },
      {
        "action": {"type": "SetStorageClass", "storageClass": "COLDLINE"},
        "condition": {"age": 90}
      }
    ]
  }
}
EOF

gsutil lifecycle set lifecycle.json gs://${PROJECT_ID}-market-data
```

## Phase 13: Verification

### Step 13.1: Test API Gateway

```bash
# Test health endpoint
curl https://$GATEWAY_URL/health

# Test public endpoints
curl https://$GATEWAY_URL/api/leaderboard

# Get Firebase token for testing
TOKEN=$(firebase auth:token)

# Test authenticated endpoints
curl -H "Authorization: Bearer $TOKEN" \
     https://$GATEWAY_URL/api/agents/list
```

### Step 13.2: Verify Services

```bash
# Check Cloud Run services
gcloud run services list --region=$REGION

# Check service logs
for SERVICE in "${SERVICES[@]}"; do
    echo "Logs for $SERVICE:"
    gcloud run logs read $SERVICE --region=$REGION --limit=10
done

# Check Kubernetes pods
kubectl get pods --all-namespaces
```

### Step 13.3: Submit Test Agent

```bash
# Create test agent
cat > test-agent.json << EOF
{
  "agentName": "Test Strategy",
  "description": "Simple moving average strategy",
  "tags": "SMA,test",
  "agentCode": "$(base64 < test-strategies/sma_strategy.py)"
}
EOF

# Submit agent
curl -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d @test-agent.json \
    https://$GATEWAY_URL/api/agents/submit
```

## Phase 14: Monitoring Setup

### Step 14.1: Create Dashboards

```bash
# Create monitoring workspace
gcloud monitoring workspaces create \
    --display-name="The Farm Mark II Monitoring" \
    --project=$PROJECT_ID
```

### Step 14.2: Set Up Alerts

```bash
# Create alert policies
gcloud alpha monitoring policies create \
    --notification-channels=CHANNEL_ID \
    --display-name="High Error Rate" \
    --condition-display-name="Error rate > 1%" \
    --condition-expression='
        resource.type="cloud_run_revision" AND
        metric.type="run.googleapis.com/request_count" AND
        metric.label.response_code_class="5xx"
    '
```

## Troubleshooting

### Common Issues

1. **API Gateway 403 Forbidden**
   - Check Firebase JWT configuration
   - Verify service account permissions
   - Ensure API Gateway service account has Cloud Run Invoker role

2. **Cloud Run Service Unavailable**
   - Check service logs: `gcloud run logs read SERVICE_NAME`
   - Verify environment variables
   - Check service account permissions

3. **Redis Connection Failed**
   - Verify VPC connector configuration
   - Check Redis instance status
   - Ensure correct REDIS_HOST environment variable

4. **Kubernetes Pods Not Starting**
   - Check pod logs: `kubectl logs POD_NAME`
   - Verify secrets are created
   - Check resource limits

## Rollback Procedure

If issues occur during deployment:

```bash
# Rollback Cloud Run services to previous revision
for SERVICE in "${SERVICES[@]}"; do
    gcloud run services update-traffic $SERVICE \
        --to-revisions=PREVIOUS_REVISION=100 \
        --region=$REGION
done

# Rollback API Gateway
gcloud api-gateway api-configs delete farm-api-config \
    --api=farm-api \
    --project=$PROJECT_ID

# Restore previous config
gcloud api-gateway api-configs create farm-api-config-previous \
    --api=farm-api \
    --openapi-spec=openapi-spec.yaml.backup \
    --project=$PROJECT_ID

# Rollback Terraform if needed
cd terraform-api-gateway
terraform plan -destroy
terraform destroy -auto-approve
```

## Post-Deployment Checklist

- [ ] All Cloud Run services are running
- [ ] API Gateway is accessible
- [ ] Authentication works
- [ ] Redis cache is operational
- [ ] Kubernetes pods are healthy
- [ ] BigQuery tables are created
- [ ] Cloud Scheduler jobs are running
- [ ] Monitoring dashboards are configured
- [ ] Alerts are set up
- [ ] Test agent submitted successfully
- [ ] Backtest completed for test agent
- [ ] Paper trading started for test agent

## Support

For issues or questions:
1. Check logs in Cloud Console
2. Review troubleshooting section
3. Contact Spooky Labs support

## Next Steps

1. **Production Configuration**
   - Set up custom domain
   - Configure SSL certificates
   - Enable Cloud CDN

2. **Security Hardening**
   - Enable VPC Service Controls
   - Set up Cloud Armor
   - Configure audit logging

3. **Performance Tuning**
   - Adjust Cloud Run scaling parameters
   - Optimize BigQuery queries
   - Configure Redis cache policies

4. **Operational Excellence**
   - Set up CI/CD pipeline
   - Implement blue-green deployments
   - Configure automated backups