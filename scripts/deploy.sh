#!/bin/bash

# The Farm Mark II - API Gateway + Cloud Run Deployment Script
# Deploys microservices architecture to Google Cloud Platform

set -e  # Exit on error

echo "=========================================="
echo "The Farm Mark II - Microservices Deployment"
echo "=========================================="

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check if project ID is provided
if [ -z "$1" ]; then
    print_error "Usage: $0 <PROJECT_ID> [REGION] [SKIP_TERRAFORM]"
    exit 1
fi

PROJECT_ID=$1
REGION=${2:-us-central1}
SKIP_TERRAFORM=${3:-false}

print_status "Starting deployment for project: $PROJECT_ID in region: $REGION"
print_status "Architecture: API Gateway + Cloud Run Microservices"

# Set the project
gcloud config set project $PROJECT_ID

# Enable required APIs
print_status "Enabling required Google Cloud APIs..."
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
    secretmanager.googleapis.com \
    --quiet

print_success "APIs enabled"

# Create Artifact Registry repository if it doesn't exist
print_status "Setting up Artifact Registry..."
gcloud artifacts repositories create cloud-run-source-deploy \
    --repository-format=docker \
    --location=$REGION \
    --description="Docker repository for Cloud Run services" \
    --quiet || print_warning "Artifact Registry repository already exists"

# Configure Docker authentication
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

# Deploy Terraform infrastructure
if [ "$SKIP_TERRAFORM" != "true" ]; then
    print_status "Deploying Terraform infrastructure (API Gateway + Cloud Run)..."
    cd terraform-api-gateway

    # Initialize Terraform with GCS backend
    terraform init -backend-config="bucket=${PROJECT_ID}-terraform-state" || {
        print_warning "Terraform state bucket doesn't exist, creating it..."
        gsutil mb -p $PROJECT_ID -l $REGION gs://${PROJECT_ID}-terraform-state
        terraform init -backend-config="bucket=${PROJECT_ID}-terraform-state"
    }

    # Plan and apply
    terraform plan -var="project_id=$PROJECT_ID" -var="region=$REGION" -out=tfplan
    terraform apply tfplan

    cd ..
    print_success "Terraform infrastructure deployed"
else
    print_warning "Skipping Terraform deployment"
fi

# Build and deploy Cloud Run services
print_status "Building and deploying Cloud Run microservices..."

SERVICES=(
    "agents-service"
    "backtest-service"
    "paper-trading-service"
    "leaderboard-service"
    "fmel-service"
)

for SERVICE in "${SERVICES[@]}"; do
    print_status "Building and deploying $SERVICE..."
    cd cloud-run-services/$SERVICE

    # Build and push Docker image
    docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE}:latest .
    docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE}:latest

    # Deploy to Cloud Run
    gcloud run deploy $SERVICE \
        --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE}:latest \
        --region $REGION \
        --platform managed \
        --no-allow-unauthenticated \
        --service-account ${SERVICE}@${PROJECT_ID}.iam.gserviceaccount.com \
        --set-env-vars "PROJECT_ID=$PROJECT_ID,REGION=$REGION" \
        --max-instances 100 \
        --min-instances 0 \
        --memory 1Gi \
        --cpu 1 \
        --timeout 300

    cd ../..
    print_success "$SERVICE deployed"
done

print_success "All Cloud Run services deployed"

# Deploy API Gateway
print_status "Deploying API Gateway..."
cd api-gateway

# Update OpenAPI spec with project-specific values
sed -i.bak "s/YOUR_PROJECT_ID/${PROJECT_ID}/g" openapi-spec.yaml
sed -i.bak "s/YOUR_REGION/${REGION}/g" openapi-spec.yaml

# Create API
gcloud api-gateway apis create farm-api \
    --project=$PROJECT_ID \
    --quiet || print_warning "API already exists"

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
    --project=$PROJECT_ID \
    --quiet || print_warning "Gateway already exists"

cd ..
print_success "API Gateway deployed"

# Deploy container images for Kubernetes workloads
print_status "Building and deploying Kubernetes container images..."

# Backtest runner
print_status "Building backtest-runner image..."
cd containers/backtest-runner
docker build -t gcr.io/$PROJECT_ID/backtest-runner:latest .
docker push gcr.io/$PROJECT_ID/backtest-runner:latest
cd ../..

# Paper trader
print_status "Building paper-trader image..."
cd containers/paper-trader
docker build -t gcr.io/$PROJECT_ID/paper-trader:latest .
docker push gcr.io/$PROJECT_ID/paper-trader:latest
cd ../..

# Data ingester
print_status "Building data-ingester image..."
cd data-ingesters/unified-ingester
docker build -t gcr.io/$PROJECT_ID/data-ingester:latest .
docker push gcr.io/$PROJECT_ID/data-ingester:latest
cd ../..

print_success "Container images deployed"

# Setup Kubernetes resources
if kubectl get nodes &> /dev/null; then
    print_status "Setting up Kubernetes resources..."

    # Get GKE cluster credentials
    gcloud container clusters get-credentials farm-cluster --region=$REGION

    # Create namespaces
    kubectl create namespace paper-trading --dry-run=client -o yaml | kubectl apply -f -
    kubectl create namespace data-ingestion --dry-run=client -o yaml | kubectl apply -f -
    kubectl create namespace backtesting --dry-run=client -o yaml | kubectl apply -f -

    # Apply configurations
    kubectl apply -f kubernetes/

    print_success "Kubernetes resources configured"
else
    print_warning "Kubernetes cluster not available, skipping K8s setup"
fi

# Create BigQuery datasets and tables
print_status "Setting up BigQuery datasets..."
bq mk --dataset --location=$REGION --description="Market data storage" ${PROJECT_ID}:market_data || true
bq mk --dataset --location=$REGION --description="Analytics data" ${PROJECT_ID}:analytics || true
bq mk --dataset --location=$REGION --description="FMEL data" ${PROJECT_ID}:fmel || true

# Create tables
bq mk --table \
    ${PROJECT_ID}:market_data.ohlcv \
    schemas/bigquery/market_data_ohlcv.json || true

bq mk --table \
    ${PROJECT_ID}:analytics.agent_performance \
    schemas/bigquery/agent_performance.json || true

bq mk --table \
    ${PROJECT_ID}:fmel.trading_decisions \
    schemas/bigquery/trading_decisions.json || true

print_success "BigQuery datasets and tables created"

# Create Cloud Scheduler jobs
print_status "Setting up Cloud Scheduler jobs..."
gcloud scheduler jobs create pubsub market-data-ingestion \
    --schedule="*/5 * * * *" \
    --topic=market-data-ingestion \
    --message-body="{}" \
    --location=$REGION \
    --quiet || true

gcloud scheduler jobs create pubsub leaderboard-update \
    --schedule="0 */1 * * *" \
    --topic=leaderboard-update \
    --message-body="{}" \
    --location=$REGION \
    --quiet || true

print_success "Cloud Scheduler jobs configured"

# Create necessary secrets
print_status "Setting up secrets..."
echo "PLACEHOLDER" | gcloud secrets create alpaca-api-key --data-file=- --quiet || true
echo "PLACEHOLDER" | gcloud secrets create alpaca-secret-key --data-file=- --quiet || true
echo "PLACEHOLDER" | gcloud secrets create firebase-api-key --data-file=- --quiet || true

print_success "Secrets configured (remember to update with actual values)"

# Get API Gateway URL
GATEWAY_URL=$(gcloud api-gateway gateways describe farm-gateway \
    --location=$REGION \
    --format="value(defaultHostname)" 2>/dev/null || echo "pending")

# Final status
echo ""
echo "=========================================="
print_success "Deployment completed successfully!"
echo "=========================================="
echo ""
echo "PROJECT DETAILS:"
echo "  - Project ID: $PROJECT_ID"
echo "  - Region: $REGION"
echo "  - API Gateway URL: https://$GATEWAY_URL"
echo ""
echo "DEPLOYED SERVICES:"
echo "  ✓ agents-service (Agent management)"
echo "  ✓ backtest-service (Backtesting via Cloud Build)"
echo "  ✓ paper-trading-service (Kicks off paper trading in K8s)"
echo "  ✓ leaderboard-service (Redis-cached rankings)"
echo "  ✓ fmel-service (FMEL analytics)"
echo ""
echo "EXTERNAL DEPENDENCIES:"
echo "  ✓ Cloud Functions for account operations (external repo)"
echo "    - create-account: Creates Alpaca paper trading accounts"
echo "    - fund-account: Funds accounts with initial capital"
echo ""
echo "NEXT STEPS:"
echo "  1. Update Alpaca API keys:"
echo "     gcloud secrets versions add alpaca-api-key --data-file=- "
echo ""
echo "  2. Configure Firebase authentication"
echo ""
echo "  3. Test the API:"
echo "     curl https://$GATEWAY_URL/health"
echo ""
echo "  4. Upload market data CSVs to Cloud Storage:"
echo "     gsutil cp data/*.csv gs://${PROJECT_ID}-market-data/"
echo ""
echo "  5. Submit your first agent via the API"
echo ""
print_status "Deployment script finished"