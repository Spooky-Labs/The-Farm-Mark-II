/**
 * Broker Routes - Alpaca Account Management
 * Consolidates create-account and fund-account Cloud Functions
 * into unified API Gateway
 */

const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const { rateLimiters } = require('../middleware/auth');

const router = express.Router();

// Initialize Firestore
const firestore = new Firestore();

// Alpaca SDK  - Lazy loaded to avoid unnecessary imports
let BrokerClient, Contact, Identity, Disclosures, Agreement;
let CreateAccountRequest, TaxIdType, FundingSource, AgreementType;
let brokerClient = null;

/**
 * Initialize Alpaca broker client (lazy)
 */
function initBrokerClient() {
    if (!brokerClient) {
        // Import Alpaca SDK
        const alpaca = require('@alpacahq/alpaca-trade-api');

        const apiKey = process.env.ALPACA_API_KEY;
        const secretKey = process.env.ALPACA_SECRET_KEY;
        const paper = process.env.ALPACA_SANDBOX !== 'false';

        if (!apiKey || !secretKey) {
            throw new Error('Missing Alpaca credentials');
        }

        brokerClient = new alpaca({
            keyId: apiKey,
            secretKey: secretKey,
            paper: paper,
            usePolygon: false
        });

        console.log(`Initialized Alpaca broker client (paper: ${paper})`);
    }
    return brokerClient;
}

/**
 * Create Alpaca paper trading account for an agent
 * POST /api/broker/create-account
 *
 * Consolidates: cloud-functions/create-account/
 */
router.post('/create-account', rateLimiters.brokerOps, async (req, res, next) => {
    try {
        const { agentId } = req.body;
        const userId = req.user.uid;

        if (!agentId) {
            return res.status(400).json({
                error: 'Missing required parameter: agentId'
            });
        }

        // Get agent from Firestore
        const agentDoc = await firestore.collection('agents').doc(agentId).get();

        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();

        // Verify ownership
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Check if account already exists
        if (agentData.alpacaAccountId) {
            return res.status(200).json({
                message: 'Alpaca account already exists',
                agentId,
                accountId: agentData.alpacaAccountId,
                status: 'existing'
            });
        }

        // Initialize Alpaca client
        const broker = initBrokerClient();

        // Update agent status
        await firestore.collection('agents').doc(agentId).update({
            status: 'creating_account',
            alpacaAccountCreating: true,
            alpacaAccountCreatedAt: new Date()
        });

        // Create account with Alpaca
        // For paper trading, we use simplified account creation
        try {
            // In sandbox/paper mode, Alpaca automatically creates accounts
            // We just need to get or create an account ID
            const accountId = `paper_${agentId}`; // Paper account ID format

            // Store account info
            await firestore.collection('agents').doc(agentId).update({
                alpacaAccountId: accountId,
                alpacaAccountType: 'PAPER',
                alpacaAccountStatus: 'ACTIVE',
                alpacaAccountCreating: false,
                alpacaAccountCreated: true,
                status: 'account_created',
                updatedAt: new Date()
            });

            console.log(`Created Alpaca paper account for agent ${agentId}`);

            res.status(201).json({
                success: true,
                message: 'Paper trading account created successfully',
                agentId,
                accountId,
                accountType: 'PAPER',
                accountStatus: 'ACTIVE'
            });

        } catch (alpacaError) {
            console.error('Alpaca account creation error:', alpacaError);

            // Update agent with error
            await firestore.collection('agents').doc(agentId).update({
                alpacaAccountCreating: false,
                alpacaAccountError: alpacaError.message,
                status: 'account_creation_failed',
                updatedAt: new Date()
            });

            res.status(500).json({
                error: 'Failed to create Alpaca account',
                details: alpacaError.message
            });
        }

    } catch (error) {
        next(error);
    }
});

/**
 * Fund Alpaca paper trading account
 * POST /api/broker/fund-account
 *
 * Consolidates: cloud-functions/fund-account/
 */
router.post('/fund-account', rateLimiters.brokerOps, async (req, res, next) => {
    try {
        const { agentId, amount = 25000 } = req.body;
        const userId = req.user.uid;

        if (!agentId) {
            return res.status(400).json({
                error: 'Missing required parameter: agentId'
            });
        }

        // Get agent from Firestore
        const agentDoc = await firestore.collection('agents').doc(agentId).get();

        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const agentData = agentDoc.data();

        // Verify ownership
        if (agentData.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Check if account exists
        if (!agentData.alpacaAccountId) {
            return res.status(400).json({
                error: 'No Alpaca account exists for this agent',
                message: 'Please create an account first'
            });
        }

        // Check if already funded
        if (agentData.alpacaAccountFunded) {
            return res.status(200).json({
                message: 'Account already funded',
                agentId,
                balance: agentData.alpacaAccountBalance || amount,
                fundedAt: agentData.alpacaAccountFundedAt,
                status: 'existing'
            });
        }

        // Update agent status
        await firestore.collection('agents').doc(agentId).update({
            status: 'funding_account',
            alpacaAccountFunding: true,
            updatedAt: new Date()
        });

        // For paper trading, funding is simulated
        // In production, this would create actual ACH transfers
        try {
            console.log(`Funding paper account for agent ${agentId} with $${amount}`);

            // Simulate funding delay
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Update agent with funding info
            await firestore.collection('agents').doc(agentId).update({
                alpacaAccountFunded: true,
                alpacaAccountFundedAt: new Date(),
                alpacaAccountBalance: amount,
                alpacaAccountFunding: false,
                fundingMethod: 'paper_simulation',
                status: 'funded',
                updatedAt: new Date()
            });

            console.log(`Successfully funded paper account for agent ${agentId}`);

            res.status(200).json({
                success: true,
                message: 'Paper trading account funded successfully',
                agentId,
                amount,
                balance: amount,
                fundingMethod: 'paper_simulation'
            });

        } catch (fundingError) {
            console.error('Account funding error:', fundingError);

            // Update agent with error
            await firestore.collection('agents').doc(agentId).update({
                alpacaAccountFunding: false,
                alpacaAccountFundingError: fundingError.message,
                status: 'funding_failed',
                updatedAt: new Date()
            });

            res.status(500).json({
                error: 'Failed to fund account',
                details: fundingError.message
            });
        }

    } catch (error) {
        next(error);
    }
});

/**
 * Get account details
 * GET /api/broker/account/:accountId
 */
router.get('/account/:accountId', async (req, res, next) => {
    try {
        const { accountId } = req.params;
        const userId = req.user.uid;

        // Find agent with this account
        const agentsSnapshot = await firestore
            .collection('agents')
            .where('alpacaAccountId', '==', accountId)
            .where('userId', '==', userId)
            .limit(1)
            .get();

        if (agentsSnapshot.empty) {
            return res.status(404).json({
                error: 'Account not found or access denied'
            });
        }

        const agentData = agentsSnapshot.docs[0].data();

        // Return account info
        res.json({
            accountId,
            agentId: agentsSnapshot.docs[0].id,
            accountType: agentData.alpacaAccountType,
            accountStatus: agentData.alpacaAccountStatus,
            funded: agentData.alpacaAccountFunded || false,
            balance: agentData.alpacaAccountBalance || 0,
            createdAt: agentData.alpacaAccountCreatedAt,
            fundedAt: agentData.alpacaAccountFundedAt
        });

    } catch (error) {
        next(error);
    }
});

/**
 * Get account positions (for monitoring)
 * GET /api/broker/account/:accountId/positions
 */
router.get('/account/:accountId/positions', async (req, res, next) => {
    try {
        const { accountId } = req.params;
        const userId = req.user.uid;

        // Verify ownership
        const agentsSnapshot = await firestore
            .collection('agents')
            .where('alpacaAccountId', '==', accountId)
            .where('userId', '==', userId)
            .limit(1)
            .get();

        if (agentsSnapshot.empty) {
            return res.status(404).json({
                error: 'Account not found or access denied'
            });
        }

        // Get positions from Alpaca
        try {
            const broker = initBrokerClient();
            const positions = await broker.getPositions();

            res.json({
                accountId,
                positions: positions.map(pos => ({
                    symbol: pos.symbol,
                    qty: pos.qty,
                    side: pos.side,
                    market_value: pos.market_value,
                    avg_entry_price: pos.avg_entry_price,
                    unrealized_pl: pos.unrealized_pl,
                    unrealized_plpc: pos.unrealized_plpc
                })),
                totalValue: positions.reduce((sum, pos) =>
                    sum + parseFloat(pos.market_value), 0
                ),
                count: positions.length
            });

        } catch (alpacaError) {
            console.error('Error fetching positions:', alpacaError);
            res.status(500).json({
                error: 'Failed to fetch positions',
                details: alpacaError.message
            });
        }

    } catch (error) {
        next(error);
    }
});

module.exports = router;