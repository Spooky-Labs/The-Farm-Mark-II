"""
Fund Alpaca Paper Trading Account
Uses Alpaca Broker API Python SDK to fund accounts with ACH transfers
"""

import os
import json
import logging
from datetime import datetime
from firebase_functions import https_fn
from firebase_admin import initialize_app, firestore, auth
from alpaca.broker import BrokerClient
from alpaca.broker.requests import CreateACHTransferRequest
from alpaca.broker.enums import TransferDirection, TransferTiming

# Initialize Firebase
initialize_app()
db = firestore.client()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@https_fn.on_request(cors=True)
def fund_account(req: https_fn.Request) -> https_fn.Response:
    """
    Fund an Alpaca paper trading account with $25,000

    POST /
    Body: { "agentId": "agent-uuid" }
    Headers: Authorization: Bearer <firebase-token>
    """

    # Handle CORS preflight
    if req.method == "OPTIONS":
        return https_fn.Response(
            status=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Max-Age": "3600",
            },
        )

    # Only accept POST requests
    if req.method != "POST":
        return https_fn.Response(
            json.dumps({"error": "Method not allowed"}),
            status=405,
            headers={"Content-Type": "application/json"},
        )

    try:
        # Verify Firebase authentication
        auth_header = req.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return https_fn.Response(
                json.dumps({"error": "Missing or invalid authorization token"}),
                status=401,
                headers={"Content-Type": "application/json"},
            )

        token = auth_header.split("Bearer ")[1]
        decoded_token = auth.verify_id_token(token)
        user_id = decoded_token["uid"]

        # Get request body
        request_json = req.get_json(silent=True)
        if not request_json or "agentId" not in request_json:
            return https_fn.Response(
                json.dumps({"error": "Missing required parameter: agentId"}),
                status=400,
                headers={"Content-Type": "application/json"},
            )

        agent_id = request_json["agentId"]
        amount = request_json.get("amount", 25000)  # Default $25k

        # Get agent from Firestore and verify ownership
        agent_ref = db.collection("agents").document(agent_id)
        agent_doc = agent_ref.get()

        if not agent_doc.exists:
            return https_fn.Response(
                json.dumps({"error": "Agent not found"}),
                status=404,
                headers={"Content-Type": "application/json"},
            )

        agent_data = agent_doc.to_dict()
        if agent_data.get("userId") != user_id:
            return https_fn.Response(
                json.dumps({"error": "Access denied"}),
                status=403,
                headers={"Content-Type": "application/json"},
            )

        # Check if account exists
        account_id = agent_data.get("alpacaAccountId")
        if not account_id:
            return https_fn.Response(
                json.dumps({
                    "error": "No Alpaca account exists for this agent",
                    "message": "Please create an account first"
                }),
                status=400,
                headers={"Content-Type": "application/json"},
            )

        # Check if already funded
        if agent_data.get("alpacaAccountFunded"):
            return https_fn.Response(
                json.dumps({
                    "message": "Account already funded",
                    "agentId": agent_id,
                    "balance": agent_data.get("alpacaAccountBalance", amount),
                    "fundedAt": agent_data.get("alpacaAccountFundedAt").isoformat() if agent_data.get("alpacaAccountFundedAt") else None,
                    "status": "existing"
                }),
                status=200,
                headers={"Content-Type": "application/json"},
            )

        # Initialize Alpaca Broker Client
        api_key = os.environ.get("ALPACA_API_KEY")
        secret_key = os.environ.get("ALPACA_SECRET_KEY")
        sandbox = os.environ.get("ALPACA_SANDBOX", "true").lower() == "true"

        if not api_key or not secret_key:
            logger.error("Missing Alpaca credentials")
            return https_fn.Response(
                json.dumps({"error": "Server configuration error"}),
                status=500,
                headers={"Content-Type": "application/json"},
            )

        broker_client = BrokerClient(
            api_key=api_key,
            secret_key=secret_key,
            sandbox=sandbox
        )

        # Initialize agent_id for error handling
        agent_id = agent_ref.id if agent_ref else None

        # Update agent status
        agent_ref.update({
            "status": "funding_account",
            "alpacaAccountFunding": True,
            "updatedAt": datetime.utcnow()
        })

        # Create ACH transfer to fund the account
        # In sandbox mode, this simulates the funding
        transfer_request = CreateACHTransferRequest(
            amount=str(amount),
            direction=TransferDirection.INCOMING,
            timing=TransferTiming.IMMEDIATE,
            relationship_id=None  # Use default bank relationship
        )

        transfer = broker_client.create_ach_transfer_for_account(
            account_id=account_id,
            transfer_data=transfer_request
        )

        # Update agent with funding info
        agent_ref.update({
            "alpacaAccountFunded": True,
            "alpacaAccountFundedAt": datetime.utcnow(),
            "alpacaAccountBalance": amount,
            "alpacaAccountFunding": False,
            "alpacaTransferId": transfer.id,
            "alpacaTransferStatus": transfer.status,
            "fundingMethod": "ACH",
            "status": "funded",
            "updatedAt": datetime.utcnow()
        })

        logger.info(f"Funded account {account_id} for agent {agent_id} with ${amount}")

        return https_fn.Response(
            json.dumps({
                "success": True,
                "message": "Account funded successfully",
                "agentId": agent_id,
                "accountId": account_id,
                "amount": amount,
                "balance": amount,
                "transferId": transfer.id,
                "transferStatus": transfer.status,
                "fundingMethod": "ACH"
            }),
            status=200,
            headers={"Content-Type": "application/json"},
        )

    except Exception as e:
        logger.error(f"Error funding account: {str(e)}", exc_info=True)

        # Try to update agent status on error
        try:
            if agent_id:
                agent_ref.update({
                    "alpacaAccountFunding": False,
                    "alpacaAccountFundingError": str(e),
                    "status": "funding_failed",
                    "updatedAt": datetime.utcnow()
                })
        except:
            pass

        return https_fn.Response(
            json.dumps({
                "error": "Failed to fund account",
                "details": str(e)
            }),
            status=500,
            headers={"Content-Type": "application/json"},
        )