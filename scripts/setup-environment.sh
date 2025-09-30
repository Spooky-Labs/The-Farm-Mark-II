#!/bin/bash

# Environment Setup Script for Spooky Labs
# Sets up local development environment and validates configuration

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

# Create environment file template
create_env_template() {
    if [ ! -f .env.example ]; then
        print_status "Creating .env.example file..."
        cat > .env.example << 'EOF'
# Core GCP Configuration
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"
export ZONE="us-central1-a"
export ENVIRONMENT="prod"

# Firebase Configuration
export FIREBASE_PROJECT="your-firebase-project-id"

# Alpaca API Credentials (REQUIRED)
export ALPACA_API_KEY="your-alpaca-api-key"
export ALPACA_SECRET_KEY="your-alpaca-secret-key"
export ALPACA_BASE_URL="https://paper-api.alpaca.markets"

# News API Credentials
export NEWS_API_KEY="your-news-api-key"

# Network Configuration (optional - defaults provided)
export VPC_CIDR="10.0.0.0/16"
export SUBNET_CIDR="10.0.0.0/20"
export POD_CIDR="10.4.0.0/14"
export SERVICE_CIDR="10.8.0.0/20"

# GKE Configuration (optional - defaults provided)
export GKE_NODE_COUNT="2"
export GKE_MACHINE_TYPE="e2-standard-2"
export GKE_DISK_SIZE_GB="50"

# Security Configuration (optional - defaults provided)
export ENABLE_NETWORK_POLICY="true"
export ENABLE_WORKLOAD_IDENTITY="true"
export ENABLE_SHIELDED_NODES="true"

# Monitoring Configuration (optional - defaults provided)
export ENABLE_MONITORING="true"
export ALERT_EMAIL="alerts@yourcompany.com"
export LOG_RETENTION_DAYS="90"

# Cost Configuration (optional - defaults provided)
export COST_BUDGET_THRESHOLD="500"
EOF
        print_success "Created .env.example file"
        print_warning "Please copy .env.example to .env and fill in your values"
    fi
}

# Load environment variables
load_environment() {
    if [ -f .env ]; then
        print_status "Loading environment variables from .env file..."
        source .env
        print_success "Environment variables loaded"
    else
        print_warning "No .env file found. Using environment variables from shell."
        print_warning "Consider creating .env file from .env.example"
    fi
}

# Validate environment
validate_environment() {
    print_status "Validating environment configuration..."

    local errors=0

    # Required variables
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

    # Optional variables with defaults
    export REGION="${REGION:-us-central1}"
    export ZONE="${ZONE:-us-central1-a}"
    export ENVIRONMENT="${ENVIRONMENT:-prod}"
    export FIREBASE_PROJECT="${FIREBASE_PROJECT:-$PROJECT_ID}"
    export ALPACA_BASE_URL="${ALPACA_BASE_URL:-https://paper-api.alpaca.markets}"

    if [ $errors -gt 0 ]; then
        print_error "Found $errors configuration errors"
        print_error "Please set the required variables and try again"
        return 1
    fi

    print_success "Environment validation passed"
}

# Test GCP access
test_gcp_access() {
    print_status "Testing Google Cloud access..."

    if ! command -v gcloud &> /dev/null; then
        print_error "gcloud CLI not found. Please install Google Cloud SDK"
        return 1
    fi

    # Check authentication
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "."; then
        print_warning "Not authenticated with Google Cloud"
        print_status "Please run: gcloud auth login"
        return 1
    fi

    # Test project access
    if ! gcloud projects describe "$PROJECT_ID" &> /dev/null; then
        print_error "Cannot access project: $PROJECT_ID"
        print_error "Please check project ID and permissions"
        return 1
    fi

    print_success "Google Cloud access verified"
}

# Test Alpaca API access
test_alpaca_access() {
    print_status "Testing Alpaca API access..."

    response=$(curl -s -w "%{http_code}" \
        -H "APCA-API-KEY-ID: $ALPACA_API_KEY" \
        -H "APCA-API-SECRET-KEY: $ALPACA_SECRET_KEY" \
        "$ALPACA_BASE_URL/v2/account" \
        -o /tmp/alpaca_test.json)

    if [ "$response" = "200" ]; then
        print_success "Alpaca API access verified"
        trading_blocked=$(cat /tmp/alpaca_test.json | grep -o '"trading_blocked":[^,]*' | cut -d':' -f2)
        if [ "$trading_blocked" = "false" ]; then
            print_success "Alpaca account is ready for trading"
        else
            print_warning "Alpaca account has trading restrictions"
        fi
    else
        print_error "Alpaca API access failed (HTTP $response)"
        print_error "Please check your Alpaca API credentials"
        return 1
    fi

    rm -f /tmp/alpaca_test.json
}

# Test News API access (if configured)
test_news_api_access() {
    if [ -n "$NEWS_API_KEY" ]; then
        print_status "Testing News API access..."

        response=$(curl -s -w "%{http_code}" \
            "https://newsapi.org/v2/everything?q=stocks&apiKey=$NEWS_API_KEY&pageSize=1" \
            -o /tmp/news_test.json)

        if [ "$response" = "200" ]; then
            print_success "News API access verified"
        else
            print_warning "News API access failed (HTTP $response)"
            print_warning "News data integration will be disabled"
        fi

        rm -f /tmp/news_test.json
    else
        print_warning "NEWS_API_KEY not set - news data integration will be disabled"
    fi
}

# Generate deployment configuration
generate_deployment_config() {
    print_status "Generating deployment configuration..."

    # Create terraform.tfvars
    cat > terraform/terraform.tfvars << EOF
# Generated by setup-environment.sh
project_id = "$PROJECT_ID"
region = "$REGION"
zone = "$ZONE"
environment = "$ENVIRONMENT"
firebase_project = "$FIREBASE_PROJECT"

# Network Configuration
vpc_cidr = "${VPC_CIDR:-10.0.0.0/16}"
subnet_cidr = "${SUBNET_CIDR:-10.0.0.0/20}"
pod_cidr = "${POD_CIDR:-10.4.0.0/14}"
service_cidr = "${SERVICE_CIDR:-10.8.0.0/20}"

# GKE Configuration
gke_node_count = ${GKE_NODE_COUNT:-2}
gke_machine_type = "${GKE_MACHINE_TYPE:-e2-standard-2}"
gke_disk_size_gb = ${GKE_DISK_SIZE_GB:-50}

# Security Configuration
enable_network_policy = ${ENABLE_NETWORK_POLICY:-true}
enable_workload_identity = ${ENABLE_WORKLOAD_IDENTITY:-true}
enable_shielded_nodes = ${ENABLE_SHIELDED_NODES:-true}

# Monitoring Configuration
enable_monitoring = ${ENABLE_MONITORING:-true}
alert_email = "${ALERT_EMAIL:-alerts@spookylabs.com}"
log_retention_days = ${LOG_RETENTION_DAYS:-90}

# Cost Configuration
cost_budget_threshold = ${COST_BUDGET_THRESHOLD:-500}
EOF

    print_success "Generated terraform/terraform.tfvars"
}

# Print summary
print_setup_summary() {
    echo ""
    echo "🔧 Environment Setup Complete"
    echo "=============================="
    echo ""
    echo "📋 Configuration Summary:"
    echo "  • Project ID: $PROJECT_ID"
    echo "  • Region: $REGION"
    echo "  • Firebase Project: $FIREBASE_PROJECT"
    echo "  • Alpaca API: Configured and verified"
    if [ -n "$NEWS_API_KEY" ]; then
        echo "  • News API: Configured"
    else
        echo "  • News API: Not configured"
    fi
    echo ""
    echo "✅ Ready for deployment!"
    echo ""
    echo "Next steps:"
    echo "  1. Run: bash deploy.sh"
    echo "  2. Wait for deployment to complete (~15-20 minutes)"
    echo "  3. Test the endpoints"
    echo ""
}

# Main function
main() {
    echo "🔧 Spooky Labs Environment Setup"
    echo "================================"
    echo ""

    create_env_template
    load_environment
    validate_environment
    test_gcp_access
    test_alpaca_access
    test_news_api_access
    generate_deployment_config
    print_setup_summary
}

# Run main function
main "$@"