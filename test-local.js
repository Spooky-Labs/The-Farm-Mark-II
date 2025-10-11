/**
 * Local Testing Script for Firebase Functions
 * Run this after starting the emulators to test all endpoints
 */

const admin = require('firebase-admin');
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Configuration
const EMULATOR_PROJECT = 'demo-test-project';
const FUNCTIONS_URL = `http://localhost:5001/${EMULATOR_PROJECT}/us-central1`;

// Initialize Admin SDK for emulator
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9000';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';

admin.initializeApp({
    projectId: EMULATOR_PROJECT,
    databaseURL: `http://localhost:9000?ns=${EMULATOR_PROJECT}`
});

// Create test user and get auth token
async function setupTestAuth() {
    try {
        // Create a test user in the emulator
        const testUser = await admin.auth().createUser({
            uid: 'test-user-' + Date.now(),
            email: `test${Date.now()}@example.com`,
            emailVerified: true,
            displayName: 'Test User'
        });

        log(`  Created test user: ${testUser.uid}`, 'yellow');

        // Create a custom token for this user
        const customToken = await admin.auth().createCustomToken(testUser.uid);

        // Exchange custom token for ID token via REST API
        // Note: In a real app, this would be done client-side
        const response = await fetch(
            `http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: customToken,
                    returnSecureToken: true
                })
            }
        );

        const data = await response.json();

        if (!data.idToken) {
            throw new Error('Failed to get ID token from emulator');
        }

        return {
            userId: testUser.uid,
            idToken: data.idToken
        };
    } catch (error) {
        log('Failed to setup test auth: ' + error.message, 'red');
        throw error;
    }
}

// Test utilities
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testEndpoint(name, testFn) {
    try {
        log(`\nTesting ${name}...`, 'blue');
        await testFn();
        log(`✓ ${name} passed`, 'green');
        return true;
    } catch (error) {
        log(`✗ ${name} failed: ${error.message}`, 'red');
        console.error(error);
        return false;
    }
}

// Create sample Python files for testing (multiple files)
function createSampleAgentFiles() {
    const strategyCode = `
import backtrader as bt

class TestStrategy(bt.Strategy):
    def __init__(self):
        self.sma = bt.indicators.SimpleMovingAverage(period=20)

    def next(self):
        if self.data.close[0] > self.sma[0]:
            if not self.position:
                self.buy()
        elif self.position:
            self.sell()
`;

    const utilsCode = `
def calculate_position_size(capital, risk_percent):
    return capital * risk_percent / 100

def log_trade(trade):
    print(f"Trade: {trade}")
`;

    const files = [
        { name: 'strategy.py', content: strategyCode },
        { name: 'utils.py', content: utilsCode }
    ];

    const filePaths = files.map(file => {
        const filePath = path.join(__dirname, file.name);
        fs.writeFileSync(filePath, file.content);
        return { path: filePath, name: file.name };
    });

    return filePaths;
}

// Test Functions
async function runTests() {
    log('\n=== Firebase Functions Local Testing ===\n', 'yellow');
    log('Make sure emulators are running: firebase emulators:start\n', 'yellow');

    // Setup authentication first
    log('\nSetting up test authentication...', 'blue');
    const auth = await setupTestAuth();
    const AUTH_TOKEN = auth.idToken;
    log('Authentication ready!', 'green');

    const results = [];
    let agentId = null;

    // Test 1: Submit Agent (with multiple files)
    results.push(await testEndpoint('submitAgent', async () => {
        const agentFiles = createSampleAgentFiles();
        const form = new FormData();

        // Append multiple files
        agentFiles.forEach(file => {
            form.append('files', fs.createReadStream(file.path), file.name);
        });

        const response = await fetch(`${FUNCTIONS_URL}/submitAgent`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTH_TOKEN}`,
                ...form.getHeaders()
            },
            body: form
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        agentId = data.agentId;
        log(`  Agent ID: ${agentId}`, 'yellow');
        log(`  Files uploaded: ${data.numberOfFiles}`, 'yellow');

        // Cleanup
        agentFiles.forEach(file => fs.unlinkSync(file.path));
    }));

    // Test 2: Create Account (Mock)
    results.push(await testEndpoint('createAccount (Mock)', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/createAccountMock`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTH_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ agentId: agentId || 'test-agent-123' })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        log(`  Account ID: ${data.accountId}`, 'yellow');
    }));

    // Test 3: Fund Account (Mock)
    results.push(await testEndpoint('fundAccount (Mock)', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/fundAccountMock`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTH_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                agentId: agentId || 'test-agent-123',
                amount: 100000
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        log(`  Balance: $${data.balance}`, 'yellow');
    }));

    // Test 4: Begin Paper Trading
    results.push(await testEndpoint('beginPaperTrading', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/beginPaperTrading`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTH_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ agentId: agentId || 'test-agent-123' })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        log(`  Session ID: ${data.deploymentId}`, 'yellow');
    }));

    // Test 5: Stop Paper Trading
    results.push(await testEndpoint('stopPaperTrading', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/stopPaperTrading`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTH_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ agentId: agentId || 'test-agent-123' })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        log(`  Status: ${data.message}`, 'yellow');
    }));

    // Test 6: Get Leaderboard
    results.push(await testEndpoint('getLeaderboard', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/getLeaderboard?timeframe=weekly`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        log(`  Entries: ${data.leaderboard.length}`, 'yellow');
        if (data.message) {
            log(`  Note: ${data.message}`, 'yellow');
        }
    }));

    // Test 7: Storage Trigger (updateAgentMetadata)
    results.push(await testEndpoint('Storage Trigger Simulation', async () => {
        log('  Storage triggers fire automatically when files are uploaded', 'yellow');
        log('  In production, uploading to storage will trigger updateAgentMetadata', 'yellow');

        // Simulate by uploading to storage bucket
        const bucket = admin.storage().bucket();
        const file = bucket.file(`agents/test-user/test-${Date.now()}/strategy.py`);

        await file.save('# Test strategy code', {
            metadata: {
                contentType: 'text/plain'
            }
        });

        log('  File uploaded - trigger would fire if configured', 'yellow');
    }));

    // Summary
    log('\n=== Test Summary ===', 'yellow');
    const passed = results.filter(r => r).length;
    const failed = results.length - passed;

    log(`Passed: ${passed}/${results.length}`, passed === results.length ? 'green' : 'yellow');
    if (failed > 0) {
        log(`Failed: ${failed}/${results.length}`, 'red');
    }

    log('\n=== Notes ===', 'blue');
    log('• Authentication emulator provides real token verification', 'yellow');
    log('• Python functions (createAccount, fundAccount) are using mocks', 'yellow');
    log('• BigQuery leaderboard returns empty data (expected in emulator)', 'yellow');
    log('• Storage triggers require manual testing or file uploads', 'yellow');
    log('• Cloud Build backtesting is not available in emulator', 'yellow');

    process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
    log('Test runner failed:', 'red');
    console.error(error);
    process.exit(1);
});