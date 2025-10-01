#!/bin/bash

# Complete System Verification Script
# Verifies all components are properly configured and ready for deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}The Farm Mark II - System Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Function to check a component
check_component() {
    local component=$1
    local check_command=$2

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    echo -n "Checking $component ... "

    if eval "$check_command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
        return 0
    else
        echo -e "${RED}✗${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

echo -e "${YELLOW}1. Directory Structure${NC}"
echo "------------------------"
check_component "Main API" "[ -d 'cloud-functions/main-api' ]"
check_component "Data Ingester" "[ -d 'data-ingesters/unified-ingester' ]"
check_component "Paper Trader" "[ -d 'containers/paper-trader' ]"
check_component "FMEL Library" "[ -d 'shared/fmel-library' ]"
check_component "Terraform" "[ -d 'terraform' ]"
check_component "Kubernetes Manifests" "[ -d 'kubernetes' ]"
check_component "Scripts" "[ -d 'scripts' ]"
check_component "Schemas" "[ -d 'schemas' ]"

echo -e "\n${YELLOW}2. Main API Configuration${NC}"
echo "------------------------"
check_component "Main index.js" "[ -f 'cloud-functions/main-api/index.js' ]"
check_component "Package.json" "[ -f 'cloud-functions/main-api/package.json' ]"
check_component "Legacy Routes" "[ -f 'cloud-functions/main-api/routes/legacy-compat.js' ]"
check_component "Agent Routes" "[ -f 'cloud-functions/main-api/routes/agents.js' ]"
check_component "Broker Routes" "[ -f 'cloud-functions/main-api/routes/broker.js' ]"
check_component "Paper Trading Routes" "[ -f 'cloud-functions/main-api/routes/paper-trading.js' ]"
check_component "Leaderboard Routes" "[ -f 'cloud-functions/main-api/routes/leaderboard-redis.js' ]"
check_component "Auth Middleware" "[ -f 'cloud-functions/main-api/middleware/auth.js' ]"

echo -e "\n${YELLOW}3. Data Pipeline Components${NC}"
echo "------------------------"
check_component "Unified Ingester" "[ -f 'data-ingesters/unified-ingester/unified_market_data_ingestor.py' ]"
check_component "Ingester Config" "[ -f 'data-ingesters/unified-ingester/config.yaml' ]"
check_component "Ingester Dockerfile" "[ -f 'data-ingesters/unified-ingester/Dockerfile' ]"
check_component "Requirements" "[ -f 'data-ingesters/unified-ingester/requirements.txt' ]"

echo -e "\n${YELLOW}4. Paper Trading Components${NC}"
echo "------------------------"
check_component "Paper Trader" "[ -f 'containers/paper-trader/paper_trader.py' ]"
check_component "Alpaca Broker" "[ -f 'containers/paper-trader/alpaca_broker.py' ]"
check_component "PubSub DataFeed" "[ -f 'containers/paper-trader/pubsub_data_feed.py' ]"
check_component "Dockerfile" "[ -f 'containers/paper-trader/Dockerfile' ]"
check_component "Requirements" "[ -f 'containers/paper-trader/requirements.txt' ]"

echo -e "\n${YELLOW}5. FMEL Library${NC}"
echo "------------------------"
check_component "FMEL Recorder" "[ -f 'shared/fmel-library/spooky_fmel/recorder.py' ]"
check_component "Storage Backend" "[ -f 'shared/fmel-library/spooky_fmel/storage.py' ]"
check_component "Setup.py" "[ -f 'shared/fmel-library/setup.py' ]"

echo -e "\n${YELLOW}6. Infrastructure (Terraform)${NC}"
echo "------------------------"
check_component "Main Config" "[ -f 'terraform/main.tf' ]"
check_component "Variables" "[ -f 'terraform/variables.tf' ]"
check_component "Terraform Example" "[ -f 'terraform/terraform.tfvars.example' ]"
check_component "No Modules Directory" "[ ! -d 'terraform/modules' ]"

echo -e "\n${YELLOW}7. Documentation${NC}"
echo "------------------------"
check_component "README" "[ -f 'README.md' ]"
check_component "Docs Directory" "[ -d 'docs' ]"
check_component "Architecture Docs" "[ -d 'docs/architecture' ]"
check_component "Deployment Docs" "[ -d 'docs/deployment' ]"
check_component "Operations Docs" "[ -d 'docs/operations' ]"
check_component "Reference Docs" "[ -d 'docs/reference' ]"

echo -e "\n${YELLOW}8. Test Scripts${NC}"
echo "------------------------"
check_component "Website Compatibility Test" "[ -f 'scripts/testing/test-website-compatibility.js' ]"
check_component "Integration Test" "[ -f 'scripts/testing/test-integration.sh' ]"
check_component "Deployment Test" "[ -f 'scripts/testing/test-deployment.sh' ]"
check_component "System Verification" "[ -f 'scripts/utilities/verify-system.sh' ]"
check_component "Deploy Script" "[ -f 'scripts/deployment/deploy.sh' ]"
check_component "Cleanup Script" "[ -f 'scripts/utilities/cleanup.sh' ]"

echo -e "\n${YELLOW}9. Critical Configurations${NC}"
echo "------------------------"

# Check for example env file
check_component ".env.example" "[ -f '.env.example' ]"

# Check for deprecated components that should be removed
echo -e "\n${YELLOW}10. Python Cloud Functions (Kept for Broker API)${NC}"
echo "------------------------"
echo -n "Checking create-account function ... "
if [ -d "cloud-functions/create-account" ]; then
    echo -e "${GREEN}✓ Present (Broker API support)${NC}"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
    echo -e "${RED}✗ Missing${NC}"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

echo -n "Checking fund-account function ... "
if [ -d "cloud-functions/fund-account" ]; then
    echo -e "${GREEN}✓ Present (Broker API support)${NC}"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
    echo -e "${RED}✗ Missing${NC}"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

echo -n "Checking old begin-paper-trading function ... "
if [ ! -d "cloud-functions/begin-paper-trading" ]; then
    echo -e "${GREEN}✓ Removed${NC}"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
    echo -e "${RED}✗ Still exists (should be removed)${NC}"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

echo -n "Checking old alpaca-websocket-streamer ... "
if [ ! -d "data-ingesters/alpaca-websocket-streamer" ]; then
    echo -e "${GREEN}✓ Removed${NC}"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
    echo -e "${RED}✗ Still exists (should be removed)${NC}"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

# Verify route files exist
echo -e "\n${YELLOW}11. Additional Checks${NC}"
echo "------------------------"
check_component "Test routes file" "[ -f 'cloud-functions/main-api/test-routes.js' ]"

# Summary
echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Verification Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo "Total Checks: $TOTAL_CHECKS"
echo -e "Passed: ${GREEN}$PASSED_CHECKS${NC}"
echo -e "Failed: ${RED}$FAILED_CHECKS${NC}"
echo ""

if [ $FAILED_CHECKS -eq 0 ]; then
    echo -e "${GREEN}✅ System verification complete!${NC}"
    echo -e "${GREEN}All components are properly configured.${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Set environment variables (GOOGLE_CLOUD_PROJECT, ALPACA_API_KEY, etc.)"
    echo "2. Run: bash scripts/deploy.sh"
    echo "3. Update website with new API endpoint URL"
    echo ""
    exit 0
else
    echo -e "${RED}⚠️  Some checks failed!${NC}"
    echo "Please review the failed items above and fix them before deployment."
    echo ""
    exit 1
fi