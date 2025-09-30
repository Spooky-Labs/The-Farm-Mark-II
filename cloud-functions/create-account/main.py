"""
Create Alpaca Paper Trading Account
Uses Alpaca Broker API Python SDK to create paper trading accounts
"""

import os
import json
import logging
from datetime import datetime
from firebase_functions import https_fn
from firebase_admin import initialize_app, firestore, auth
from alpaca.broker import BrokerClient
from alpaca.broker.requests import (
    CreateAccountRequest,
    Contact,
    Identity,
    Disclosures,
    TrustedContact,
    Agreements,
)
from alpaca.broker.enums import (
    TaxIdType,
    FundingSource,
    AgreementType,
)

# Initialize Firebase
initialize_app()
db = firestore.client()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@https_fn.on_request(cors=True)
def create_account(req: https_fn.Request) -> https_fn.Response:
    """
    Create an Alpaca paper trading account for an agent

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

        # Check if account already exists
        if agent_data.get("alpacaAccountId"):
            return https_fn.Response(
                json.dumps({
                    "message": "Alpaca account already exists",
                    "agentId": agent_id,
                    "accountId": agent_data.get("alpacaAccountId"),
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
            "status": "creating_account",
            "alpacaAccountCreating": True,
            "alpacaAccountCreatedAt": datetime.utcnow()
        })

        # Create Alpaca account with placeholder data
        # In production, you'd collect real user information
        account_request = CreateAccountRequest(
            contact=Contact(
                email_address=f"{user_id}@spookylabs.trading",
                phone_number="555-666-7788",
                street_address=["20 N San Mateo Dr"],
                city="San Mateo",
                state="CA",
                postal_code="94401",
                country="USA"
            ),
            identity=Identity(
                given_name=f"Agent",
                family_name=agent_id[:8],
                date_of_birth="1990-01-01",
                tax_id="666-55-4321",
                tax_id_type=TaxIdType.USA_SSN,
                country_of_citizenship="USA",
                country_of_birth="USA",
                country_of_tax_residence="USA",
                funding_source=[FundingSource.EMPLOYMENT_INCOME]
            ),
            disclosures=Disclosures(
                is_control_person=False,
                is_affiliated_exchange_or_finra=False,
                is_politically_exposed=False,
                immediate_family_exposed=False
            ),
            agreements=[
                Agreements(
                    agreement=AgreementType.MARGIN,
                    signed_at="2020-09-11T18:09:33Z",
                    ip_address="185.13.21.99"
                ),
                Agreements(
                    agreement=AgreementType.ACCOUNT,
                    signed_at="2020-09-11T18:13:44Z",
                    ip_address="185.13.21.99"
                ),
                Agreements(
                    agreement=AgreementType.CUSTOMER,
                    signed_at="2020-09-11T18:13:44Z",
                    ip_address="185.13.21.99"
                ),
                Agreements(
                    agreement=AgreementType.CRYPTO,
                    signed_at="2020-09-11T18:13:44Z",
                    ip_address="185.13.21.99"
                )
            ]
        )

        # Create the account
        account = broker_client.create_account(account_request)

        # Update agent with account info
        agent_ref.update({
            "alpacaAccountId": account.id,
            "alpacaAccountType": "PAPER" if sandbox else "LIVE",
            "alpacaAccountStatus": account.status,
            "alpacaAccountCreating": False,
            "alpacaAccountCreated": True,
            "status": "account_created",
            "updatedAt": datetime.utcnow()
        })

        logger.info(f"Created Alpaca account {account.id} for agent {agent_id}")

        return https_fn.Response(
            json.dumps({
                "success": True,
                "message": "Alpaca account created successfully",
                "agentId": agent_id,
                "accountId": account.id,
                "accountType": "PAPER" if sandbox else "LIVE",
                "accountStatus": account.status
            }),
            status=201,
            headers={"Content-Type": "application/json"},
        )

    except Exception as e:
        logger.error(f"Error creating account: {str(e)}", exc_info=True)

        # Try to update agent status on error
        try:
            if agent_id:
                agent_ref.update({
                    "alpacaAccountCreating": False,
                    "alpacaAccountError": str(e),
                    "status": "account_creation_failed",
                    "updatedAt": datetime.utcnow()
                })
        except:
            pass

        return https_fn.Response(
            json.dumps({
                "error": "Failed to create Alpaca account",
                "details": str(e)
            }),
            status=500,
            headers={"Content-Type": "application/json"},
        )