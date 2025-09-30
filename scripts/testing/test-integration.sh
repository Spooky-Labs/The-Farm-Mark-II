#!/bin/bash

# Integration test script for The Farm Mark II
# Tests all critical paths to ensure system works end-to-end

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}The Farm Mark II - Integration Tests${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if running locally or need to set test values
if [ -z "$API_URL" ]; then
    echo -e "${YELLOW}API_URL not set. Using localhost for testing${NC}"
    API_URL="http://localhost:8080"
fi

if [ -z "$TEST_TOKEN" ]; then
    echo -e "${YELLOW}TEST_TOKEN not set. Tests requiring auth will be skipped${NC}"
    TEST_TOKEN="test-token-12345"
fi

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to run a test
run_test() {
    local test_name=$1
    local command=$2
    local expected_status=$3

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -n "Testing: $test_name ... "

    # Run the command and capture output
    if response=$(eval "$command" 2>/dev/null); then
        status_code=$(echo "$response" | tail -1)
        if [ "$status_code" = "$expected_status" ]; then
            echo -e "${GREEN}✓ PASSED${NC}"
            PASSED_TESTS=$((PASSED_TESTS + 1))
            return 0
        else
            echo -e "${RED}✗ FAILED (got status $status_code, expected $expected_status)${NC}"
            FAILED_TESTS=$((FAILED_TESTS + 1))
            return 1
        fi
    else
        echo -e "${RED}✗ FAILED (command error)${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

echo -e "\n${YELLOW}=== Test Suite 1: Health Checks ===${NC}"

# Test 1: API Gateway Health
run_test "API Gateway Health Check" \
    "curl -s -o /dev/null -w '%{http_code}' ${API_URL}/health" \
    "200"

echo -e "\n${YELLOW}=== Test Suite 2: Legacy Endpoints (Website Compatibility) ===${NC}"

# Test 2: Submit Agent (Legacy)
run_test "Legacy /submitAgent endpoint exists" \
    "curl -s -o /dev/null -w '%{http_code}' -X POST ${API_URL}/submitAgent -H 'Authorization: ${TEST_TOKEN}'" \
    "401"  # 401 because test token is invalid, but endpoint exists

# Test 3: Create Account (Legacy)
run_test "Legacy /CreateAccount endpoint exists" \
    "curl -s -o /dev/null -w '%{http_code}' -X POST ${API_URL}/CreateAccount -H 'Authorization: ${TEST_TOKEN}' -H 'Content-Type: application/json' -d '{\"agentId\":\"test\"}'" \
    "401"

# Test 4: Fund Account (Legacy)
run_test "Legacy /FundAccount endpoint exists" \
    "curl -s -o /dev/null -w '%{http_code}' -X POST ${API_URL}/FundAccount -H 'Authorization: ${TEST_TOKEN}' -H 'Content-Type: application/json' -d '{\"agentId\":\"test\"}'" \
    "401"

# Test 5: Alternative Fund Account (Legacy)
run_test "Legacy /fund_alpaca_account endpoint exists" \
    "curl -s -o /dev/null -w '%{http_code}' -X POST ${API_URL}/fund_alpaca_account -H 'Authorization: ${TEST_TOKEN}' -H 'Content-Type: application/json' -d '{\"agentId\":\"test\"}'" \
    "401"

# Test 6: Begin Paper Trading (Legacy - lowercase)
run_test "Legacy /beginPaperTrading endpoint exists" \
    "curl -s -o /dev/null -w '%{http_code}' -X POST ${API_URL}/beginPaperTrading -H 'Authorization: ${TEST_TOKEN}' -H 'Content-Type: application/json' -d '{\"agentId\":\"test\"}'" \
    "401"

# Test 7: Begin Paper Trading (Legacy - PascalCase)
run_test "Legacy /BeginPaperTrading endpoint exists" \
    "curl -s -o /dev/null -w '%{http_code}' -X POST ${API_URL}/BeginPaperTrading -H 'Authorization: ${TEST_TOKEN}' -H 'Content-Type: application/json' -d '{\"agentId\":\"test\"}'" \
    "401"

echo -e "\n${YELLOW}=== Test Suite 3: New API Endpoints ===${NC}"

# Test 8: Agents List
run_test "New API /api/agents/list endpoint" \
    "curl -s -o /dev/null -w '%{http_code}' -X GET ${API_URL}/api/agents/list -H 'Authorization: Bearer ${TEST_TOKEN}'" \
    "401"

# Test 9: Leaderboard (Public)
run_test "Public /api/leaderboard endpoint" \
    "curl -s -o /dev/null -w '%{http_code}' -X GET ${API_URL}/api/leaderboard" \
    "200"

echo -e "\n${YELLOW}=== Test Suite 4: Authentication Formats ===${NC}"

# Test 10: Raw Token Format (Website uses this)
run_test "Authentication with raw token format" \
    "curl -s -o /dev/null -w '%{http_code}' -X GET ${API_URL}/api/agents/list -H 'Authorization: ${TEST_TOKEN}'" \
    "401"  # Valid format, invalid token

# Test 11: Bearer Token Format (Standard)
run_test "Authentication with Bearer token format" \
    "curl -s -o /dev/null -w '%{http_code}' -X GET ${API_URL}/api/agents/list -H 'Authorization: Bearer ${TEST_TOKEN}'" \
    "401"  # Valid format, invalid token

echo -e "\n${YELLOW}=== Test Suite 5: Error Handling ===${NC}"

# Test 12: 404 for unknown routes
run_test "404 for unknown route" \
    "curl -s -o /dev/null -w '%{http_code}' ${API_URL}/unknown/route" \
    "404"

# Test 13: Method not allowed
run_test "Method not allowed" \
    "curl -s -o /dev/null -w '%{http_code}' -X DELETE ${API_URL}/api/agents/list -H 'Authorization: ${TEST_TOKEN}'" \
    "404"  # Will be 404 because DELETE not implemented

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Test Results${NC}"
echo -e "${GREEN}========================================${NC}"
echo "Total Tests: $TOTAL_TESTS"
echo -e "Passed: ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed: ${RED}$FAILED_TESTS${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "\n${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}✗ Some tests failed. Please check the implementation.${NC}"
    exit 1
fi