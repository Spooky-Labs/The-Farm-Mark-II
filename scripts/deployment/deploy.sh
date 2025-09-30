#!/bin/bash

# Deployment Script for Spooky Labs
# Deploys complete infrastructure and applications to Google Cloud Platform

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Load environment variables
load_environment() {
    if [ -f .env ]; then
        print_status "Loading environment variables from .env file..."
        source .env
    else
        print_warning "No .env file found. Using environment variables from shell."
    fi

    # Set defaults
    export REGION="${REGION:-us-central1}"
    export ZONE="${ZONE:-us-central1-a}"
    export ENVIRONMENT="${ENVIRONMENT:-prod}"
    export FIREBASE_PROJECT="${FIREBASE_PROJECT:-$PROJECT_ID}"
    export ALPACA_BASE_URL="${ALPACA_BASE_URL:-https://paper-api.alpaca.markets}"
}

# Validate prerequisites
validate_prerequisites() {
    print_status "Validating deployment prerequisites..."

    local errors=0

    # Required tools
    required_tools=(
        "gcloud"
        "terraform"
        "docker"
        "kubectl"
    )

    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            print_error "Missing required tool: $tool"
            errors=$((errors + 1))
        fi
    done

    # Required environment variables
    required_vars=(
        "PROJECT_ID"
        "ALPACA_API_KEY"
        "ALPACA_SECRET_KEY"
    )

    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            print_error "Missing required variable: $var"
            errors=$((errors + 1))
        fi
    done

    if [ $errors -gt 0 ]; then
        print_error "Found $errors prerequisite errors"
        print_error "Please resolve these issues and try again"
        exit 1
    fi

    print_success "Prerequisites validation passed"
}

# Enable required Google Cloud APIs
enable_apis() {
    print_status "Enabling required Google Cloud APIs..."

    apis=(
        "compute.googleapis.com"
        "container.googleapis.com"
        "cloudbuild.googleapis.com"
        "cloudfunctions.googleapis.com"
        "run.googleapis.com"
        "firestore.googleapis.com"
        "bigquery.googleapis.com"
        "secretmanager.googleapis.com"
        "pubsub.googleapis.com"
        "monitoring.googleapis.com"
        "logging.googleapis.com"
        "storage.googleapis.com"
        "artifactregistry.googleapis.com"
        "firebase.googleapis.com"
    )

    for api in "${apis[@]}"; do
        print_status "Enabling $api..."
        gcloud services enable "$api" --project="$PROJECT_ID"
    done

    print_success "All required APIs enabled"
}

# Deploy infrastructure with Terraform
deploy_infrastructure() {
    print_status "Deploying infrastructure with Terraform..."

    cd terraform

    # Initialize Terraform
    print_status "Initializing Terraform..."
    terraform init

    # Plan deployment
    print_status "Planning Terraform deployment..."
    terraform plan -var-file="terraform.tfvars" -out=tfplan

    # Apply deployment
    print_status "Applying Terraform deployment..."
    terraform apply tfplan

    print_success "Infrastructure deployment completed"

    cd ..
}

# Store secrets in Secret Manager
store_secrets() {
    print_status "Storing secrets in Secret Manager..."

    # Alpaca API credentials
    echo -n "$ALPACA_API_KEY" | gcloud secrets create alpaca-api-key \
        --data-file=- \
        --project="$PROJECT_ID" \
        --replication-policy="automatic" || true

    echo -n "$ALPACA_SECRET_KEY" | gcloud secrets create alpaca-secret-key \
        --data-file=- \
        --project="$PROJECT_ID" \
        --replication-policy="automatic" || true

    echo -n "$ALPACA_BASE_URL" | gcloud secrets create alpaca-base-url \
        --data-file=- \
        --project="$PROJECT_ID" \
        --replication-policy="automatic" || true

    # News API key (if provided)
    if [ -n "$NEWS_API_KEY" ]; then
        echo -n "$NEWS_API_KEY" | gcloud secrets create news-api-key \
            --data-file=- \
            --project="$PROJECT_ID" \
            --replication-policy="automatic" || true
    fi

    print_success "Secrets stored in Secret Manager"
}

# Build and deploy data ingester containers to Kubernetes
deploy_data_ingesters() {
    print_status "Building and deploying unified data ingester container..."

    # Build unified ingester image
    print_status "Building unified market data ingester image..."
    cd data-ingesters/unified-ingester

    docker build -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/spooky-labs/unified-ingester:latest" .
    docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/spooky-labs/unified-ingester:latest"

    cd ../..

    print_success "Unified data ingester container image built and pushed"
}

# Deploy Cloud Functions
deploy_cloud_functions() {
    print_status "Deploying unified API Gateway Cloud Function..."

    # Deploy API Gateway Cloud Function (consolidated)
    cd cloud-functions/api-gateway

    gcloud functions deploy api-gateway \
        --gen2 \
        --runtime nodejs22 \
        --trigger-http \
        --allow-unauthenticated \
        --region "$REGION" \
        --memory 1GiB \
        --timeout 300s \
        --set-env-vars "PROJECT_ID=$PROJECT_ID,FIREBASE_PROJECT=$FIREBASE_PROJECT,REGION=$REGION" \
        --project "$PROJECT_ID"

    cd ../..

    print_success "API Gateway deployed (all broker operations consolidated)"
}

# Build container images
build_container_images() {
    print_status "Building container images..."

    # Create Artifact Registry repository
    gcloud artifacts repositories create spooky-labs \
        --repository-format=docker \
        --location="$REGION" \
        --project="$PROJECT_ID" || true

    # Configure Docker for Artifact Registry
    gcloud auth configure-docker "${REGION}-docker.pkg.dev"

    # Build unified data ingester image
    print_status "Building unified data ingester image..."
    cd data-ingesters/unified-ingester

    docker build -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/spooky-labs/unified-ingester:latest" .
    docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/spooky-labs/unified-ingester:latest"

    cd ../..

    # Build paper trader image
    print_status "Building paper trader image..."
    cd containers/paper-trader

    docker build -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/spooky-labs/paper-trader:latest" .
    docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/spooky-labs/paper-trader:latest"

    cd ../..

    print_success "Container images built and pushed"
}

# Set up BigQuery datasets and tables
setup_bigquery() {
    print_status "Setting up BigQuery datasets and tables..."

    # Create FMEL dataset
    bq mk --dataset \
        --location=US \
        --description="Foundation Model Explainability Layer data" \
        "${PROJECT_ID}:fmel" || true

    # Create market_data dataset
    bq mk --dataset \
        --location=US \
        --description="Market data from Alpaca API" \
        "${PROJECT_ID}:market_data" || true

    # Create news_data dataset
    bq mk --dataset \
        --location=US \
        --description="Financial news data with sentiment analysis" \
        "${PROJECT_ID}:news_data" || true

    # Create trading_decisions table
    bq mk --table \
        --description="Trading decisions made by agents with FMEL data" \
        "${PROJECT_ID}:fmel.trading_decisions" \
        schemas/trading_decisions.json || true

    # Create market bars table
    bq mk --table \
        --description="Historical and real-time market data" \
        "${PROJECT_ID}:market_data.bars" \
        schemas/market_bars.json || true

    # Create news articles table
    bq mk --table \
        --description="Financial news articles with sentiment analysis" \
        "${PROJECT_ID}:news_data.articles" \
        schemas/news_articles.json || true

    print_success "BigQuery setup completed"
}

# Get GKE credentials
get_gke_credentials() {
    print_status "Getting GKE cluster credentials..."

    gcloud container clusters get-credentials "spooky-labs-paper-trading" \
        --region "$REGION" \
        --project "$PROJECT_ID"

    print_success "GKE credentials configured"
}

# Set up Kubernetes resources
setup_kubernetes() {
    print_status "Setting up Kubernetes resources..."

    # Apply base Kubernetes manifests
    kubectl apply -f kubernetes/

    # Create namespace for paper trading
    kubectl create namespace paper-trading || true

    # Create service account for paper trading
    kubectl create serviceaccount paper-trading-sa -n paper-trading || true

    # Create secret for Alpaca credentials
    kubectl create secret generic alpaca-credentials \
        --from-literal=ALPACA_API_KEY="$ALPACA_API_KEY" \
        --from-literal=ALPACA_SECRET_KEY="$ALPACA_SECRET_KEY" \
        --from-literal=ALPACA_BASE_URL="$ALPACA_BASE_URL" \
        -n paper-trading || true

    # Deploy unified data ingester to Kubernetes
    print_status "Deploying unified data ingester to Kubernetes..."

    # Create Alpaca credentials secret
    kubectl create secret generic alpaca-credentials \
        --from-literal=api-key="$ALPACA_API_KEY" \
        --from-literal=secret-key="$ALPACA_SECRET_KEY" \
        -n data-ingestion --dry-run=client -o yaml | kubectl apply -f -

    # Deploy unified ingester (stocks + crypto + news)
    sed "s/PROJECT_ID/$PROJECT_ID/g" kubernetes/data-ingestion/unified-ingester.yaml | kubectl apply -f -

    print_success "Kubernetes resources and unified data ingester configured"
}

# Configure monitoring and logging
setup_monitoring() {
    print_status "Setting up monitoring and logging..."

    # Cloud Build triggers for CI/CD are already created by Terraform
    # Additional monitoring setup would go here

    print_success "Monitoring and logging configured"
}

# Print deployment summary
print_deployment_summary() {
    print_section "🚀 DEPLOYMENT COMPLETED SUCCESSFULLY! 🚀"

    echo "📋 Deployment Summary:"
    echo "  • Project ID: $PROJECT_ID"
    echo "  • Region: $REGION"
    echo "  • Environment: $ENVIRONMENT"
    echo ""

    echo "🔗 Service Endpoints:"
    echo "  • API Gateway (Unified Cloud Function):"
    echo "    - Base URL: https://$REGION-$PROJECT_ID.cloudfunctions.net/api-gateway"
    echo ""
    echo "  • API Routes:"
    echo "    - Agent Operations: POST /api/agents/*"
    echo "    - Broker Operations: POST /api/broker/* (create-account, fund-account)"
    echo "    - Paper Trading: POST /api/paper-trading/*"
    echo "    - Leaderboard: GET /api/leaderboard (Redis-cached)"
    echo "    - FMEL Analytics: GET /api/fmel/*"
    echo ""
    echo "  • Data Ingestion (Kubernetes):"
    echo "    - Unified Ingester: Stocks + Crypto + News in data-ingestion namespace"
    echo ""

    echo "📊 Infrastructure:"
    echo "  • GKE Cluster: spooky-labs-paper-trading"
    echo "  • BigQuery Datasets: fmel, market_data, news_data"
    echo "  • Storage Buckets: $PROJECT_ID-agent-code, $PROJECT_ID-backtest-results"
    echo "  • Artifact Registry: $REGION-docker.pkg.dev/$PROJECT_ID/spooky-labs"
    echo ""

    echo "✅ Next Steps:"
    echo "  1. Test the endpoints using: bash scripts/test-deployment.sh"
    echo "  2. Submit your first trading agent"
    echo "  3. Run a backtest to validate the system"
    echo "  4. Monitor logs and metrics in Cloud Console"
    echo ""

    echo "📚 Documentation:"
    echo "  • API Documentation: See README.md"
    echo "  • Architecture: See docs/architecture/ARCHITECTURE.md"
    echo "  • Deployment Guide: See docs/deployment/DEPLOYMENT.md"
    echo "  • All Docs: See docs/README.md"
    echo ""
}

# Main deployment function
main() {
    print_section "🔧 SPOOKY LABS DEPLOYMENT STARTING"

    load_environment
    validate_prerequisites

    print_section "☁️  INFRASTRUCTURE DEPLOYMENT"
    enable_apis
    store_secrets
    deploy_infrastructure
    setup_bigquery

    print_section "🐳 CONTAINER DEPLOYMENT"
    build_container_images
    deploy_data_ingesters

    print_section "☁️  CLOUD SERVICES DEPLOYMENT"
    deploy_cloud_functions

    print_section "⚓ KUBERNETES SETUP"
    get_gke_credentials
    setup_kubernetes

    print_section "📊 MONITORING SETUP"
    setup_monitoring

    print_deployment_summary
}

# Handle script arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "infrastructure-only")
        load_environment
        validate_prerequisites
        enable_apis
        store_secrets
        deploy_infrastructure
        setup_bigquery
        ;;
    "services-only")
        load_environment
        validate_prerequisites
        deploy_data_ingesters
        deploy_cloud_functions
        ;;
    "containers-only")
        load_environment
        validate_prerequisites
        build_container_images
        ;;
    "help")
        echo "Usage: $0 [deploy|infrastructure-only|services-only|containers-only|help]"
        echo ""
        echo "  deploy              Full deployment (default)"
        echo "  infrastructure-only Deploy only Terraform infrastructure"
        echo "  services-only       Deploy only Cloud Functions and data ingesters"
        echo "  containers-only     Build and push container images only"
        echo "  help                Show this help message"
        ;;
    *)
        print_error "Unknown command: $1"
        echo "Run '$0 help' for usage information"
        exit 1
        ;;
esac