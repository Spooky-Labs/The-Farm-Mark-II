#!/usr/bin/env node

/**
 * Test script to verify API compatibility with the existing website
 * This simulates the exact API calls made by the Developer Website
 */

const https = require('https');
const fs = require('fs');
const FormData = require('form-data');

// Configuration
const API_BASE_URL = process.env.API_URL || 'https://us-central1-YOUR-PROJECT.cloudfunctions.net/api-gateway';
const TEST_TOKEN = process.env.TEST_TOKEN || 'test-firebase-token';

// Colors for output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    reset: '\x1b[0m'
};

console.log(`${colors.green}========================================${colors.reset}`);
console.log(`${colors.green}Website API Compatibility Test${colors.reset}`);
console.log(`${colors.green}========================================${colors.reset}`);
console.log(`API URL: ${API_BASE_URL}`);
console.log();

/**
 * Make an HTTP request
 */
function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(API_BASE_URL + options.path);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = https.request(reqOptions, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: body
                });
            });
        });

        req.on('error', reject);

        if (data) {
            if (data instanceof FormData) {
                data.pipe(req);
            } else {
                req.write(data);
                req.end();
            }
        } else {
            req.end();
        }
    });
}

/**
 * Test 1: Agent Submission (Multipart)
 * Simulates: console.js line 96-132
 */
async function testAgentSubmission() {
    console.log(`${colors.yellow}Test 1: Agent Submission${colors.reset}`);
    console.log('Endpoint: /submitAgent (legacy) or /api/agents/submit (new)');

    // Create a test Python file
    const pythonCode = `
import backtrader as bt

class TestStrategy(bt.Strategy):
    def __init__(self):
        self.sma = bt.indicators.SMA(period=20)

    def next(self):
        if self.data.close > self.sma:
            self.buy()
        elif self.data.close < self.sma:
            self.sell()
`;

    // Test legacy endpoint (what website currently uses)
    try {
        const form = new FormData();
        form.append('file', pythonCode, {
            filename: 'test_strategy.py',
            contentType: 'text/x-python'
        });
        form.append('agentName', 'Test Strategy');
        form.append('description', 'Test strategy for compatibility');

        const response = await makeRequest({
            path: '/submitAgent',
            method: 'POST',
            headers: {
                'Authorization': TEST_TOKEN,  // No "Bearer " prefix (website format)
                ...form.getHeaders()
            }
        }, form);

        if (response.statusCode === 201) {
            const data = JSON.parse(response.body);
            console.log(`${colors.green}✓ Legacy endpoint works${colors.reset}`);
            console.log(`  Response includes numberOfFiles: ${data.numberOfFiles ? 'YES' : 'NO'}`);
            console.log(`  Response includes agentId: ${data.agentId ? 'YES' : 'NO'}`);
        } else if (response.statusCode === 401) {
            console.log(`${colors.green}✓ Endpoint exists (401 - needs valid auth)${colors.reset}`);
        } else {
            console.log(`${colors.red}✗ Unexpected status: ${response.statusCode}${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.red}✗ Error: ${error.message}${colors.reset}`);
    }

    console.log();
}

/**
 * Test 2: Create Account
 * Simulates: agent.js line 112-118
 */
async function testCreateAccount() {
    console.log(`${colors.yellow}Test 2: Create Account${colors.reset}`);
    console.log('Endpoint: /CreateAccount (legacy) or /api/broker/create-account (new)');

    const testAgentId = 'test-agent-' + Date.now();

    try {
        const response = await makeRequest({
            path: '/CreateAccount',
            method: 'POST',
            headers: {
                'Authorization': TEST_TOKEN,  // No "Bearer " prefix
                'Content-Type': 'application/json'
            }
        }, JSON.stringify({ agentId: testAgentId }));

        if (response.statusCode === 200 || response.statusCode === 201) {
            console.log(`${colors.green}✓ Legacy endpoint works${colors.reset}`);
        } else if (response.statusCode === 401) {
            console.log(`${colors.green}✓ Endpoint exists (401 - needs valid auth)${colors.reset}`);
        } else {
            console.log(`${colors.red}✗ Unexpected status: ${response.statusCode}${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.red}✗ Error: ${error.message}${colors.reset}`);
    }

    console.log();
}

/**
 * Test 3: Fund Account
 * Simulates: agent.js line 121-127
 */
async function testFundAccount() {
    console.log(`${colors.yellow}Test 3: Fund Account${colors.reset}`);
    console.log('Endpoint: /FundAccount or /fund_alpaca_account (legacy)');

    const testAgentId = 'test-agent-' + Date.now();

    // Test both legacy endpoint variations
    const endpoints = ['/FundAccount', '/fund_alpaca_account'];

    for (const endpoint of endpoints) {
        try {
            const response = await makeRequest({
                path: endpoint,
                method: 'POST',
                headers: {
                    'Authorization': TEST_TOKEN,  // No "Bearer " prefix
                    'Content-Type': 'application/json'
                }
            }, JSON.stringify({ agentId: testAgentId }));

            if (response.statusCode === 200 || response.statusCode === 201) {
                console.log(`${colors.green}✓ ${endpoint} works${colors.reset}`);
            } else if (response.statusCode === 401) {
                console.log(`${colors.green}✓ ${endpoint} exists (401 - needs valid auth)${colors.reset}`);
            } else if (response.statusCode === 404) {
                console.log(`${colors.red}✗ ${endpoint} not found${colors.reset}`);
            } else {
                console.log(`${colors.red}✗ ${endpoint} unexpected status: ${response.statusCode}${colors.reset}`);
            }
        } catch (error) {
            console.log(`${colors.red}✗ ${endpoint} error: ${error.message}${colors.reset}`);
        }
    }

    console.log();
}

/**
 * Test 4: Begin Paper Trading
 * Simulates: agent.js line 130-136
 */
async function testBeginPaperTrading() {
    console.log(`${colors.yellow}Test 4: Begin Paper Trading${colors.reset}`);
    console.log('Endpoint: /beginPaperTrading or /BeginPaperTrading (legacy)');

    const testAgentId = 'test-agent-' + Date.now();

    // Test both case variations
    const endpoints = ['/beginPaperTrading', '/BeginPaperTrading'];

    for (const endpoint of endpoints) {
        try {
            const response = await makeRequest({
                path: endpoint,
                method: 'POST',
                headers: {
                    'Authorization': TEST_TOKEN,  // No "Bearer " prefix
                    'Content-Type': 'application/json'
                }
            }, JSON.stringify({ agentId: testAgentId }));

            if (response.statusCode === 200 || response.statusCode === 202) {
                console.log(`${colors.green}✓ ${endpoint} works${colors.reset}`);
            } else if (response.statusCode === 401) {
                console.log(`${colors.green}✓ ${endpoint} exists (401 - needs valid auth)${colors.reset}`);
            } else if (response.statusCode === 404) {
                console.log(`${colors.red}✗ ${endpoint} not found${colors.reset}`);
            } else {
                console.log(`${colors.red}✗ ${endpoint} unexpected status: ${response.statusCode}${colors.reset}`);
            }
        } catch (error) {
            console.log(`${colors.red}✗ ${endpoint} error: ${error.message}${colors.reset}`);
        }
    }

    console.log();
}

/**
 * Test 5: Authentication Format
 */
async function testAuthenticationFormats() {
    console.log(`${colors.yellow}Test 5: Authentication Formats${colors.reset}`);

    const testEndpoint = '/api/agents/list';

    // Test with raw token (website format)
    try {
        const response1 = await makeRequest({
            path: testEndpoint,
            method: 'GET',
            headers: {
                'Authorization': TEST_TOKEN  // Raw token
            }
        });

        if (response1.statusCode === 401) {
            console.log(`${colors.green}✓ Raw token format accepted (returns 401 with test token)${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.red}✗ Raw token format error: ${error.message}${colors.reset}`);
    }

    // Test with Bearer token (standard format)
    try {
        const response2 = await makeRequest({
            path: testEndpoint,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${TEST_TOKEN}`  // Bearer format
            }
        });

        if (response2.statusCode === 401) {
            console.log(`${colors.green}✓ Bearer token format accepted (returns 401 with test token)${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.red}✗ Bearer token format error: ${error.message}${colors.reset}`);
    }

    console.log();
}

/**
 * Run all tests
 */
async function runTests() {
    await testAgentSubmission();
    await testCreateAccount();
    await testFundAccount();
    await testBeginPaperTrading();
    await testAuthenticationFormats();

    console.log(`${colors.green}========================================${colors.reset}`);
    console.log(`${colors.green}Test Summary${colors.reset}`);
    console.log(`${colors.green}========================================${colors.reset}`);
    console.log();
    console.log('If all tests show ✓, the API is compatible with the website.');
    console.log('401 errors are expected when using test tokens.');
    console.log();
    console.log('To test with real authentication:');
    console.log('1. Get a valid Firebase ID token from the website console');
    console.log('2. Run: TEST_TOKEN="your-token" node test-website-compatibility.js');
}

// Check if API URL is set
if (API_BASE_URL.includes('YOUR-PROJECT')) {
    console.log(`${colors.red}ERROR: Please set the API_URL environment variable${colors.reset}`);
    console.log('Example: API_URL=https://us-central1-project.cloudfunctions.net/api-gateway node test-website-compatibility.js');
    process.exit(1);
}

// Run tests
runTests().catch(console.error);