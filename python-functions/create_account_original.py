import os
import json
import logging
import time
import firebase_admin
from datetime import datetime, timezone # Import timezone

from firebase_admin import db, auth # Removed firestore if only using datetime.now()
from firebase_functions import https_fn, options

from alpaca.broker.client import BrokerClient
from alpaca.broker.models import Contact, Identity, Disclosures, Agreement
from alpaca.broker.requests import CreateAccountRequest, CreateACHRelationshipRequest
from alpaca.broker.enums import TaxIdType, FundingSource, AgreementType, BankAccountType


# --- Initialization (using default credentials) ---
app = firebase_admin.initialize_app() # Uses default credentials and environment

# Configure logging
logger = logging.getLogger("cloud_functions")

@https_fn.on_request(secrets=["ALPACA_PAPER_BROKER_API_KEY", "ALPACA_PAPER_BROKER_SECRET_KEY"], cors=options.CorsOptions(cors_origins=["*"], cors_methods=["get", "post", "options"]))
def register_alpaca_account(req: https_fn.Request) -> https_fn.Response:
    """Create an Alpaca paper trading account for an agent."""
    logger.info(f"Request Received: (Request: {req})")
    try:
        broker_client = BrokerClient(
            api_key=os.environ.get('ALPACA_PAPER_BROKER_API_KEY'),    # Still get keys from env
            secret_key=os.environ.get('ALPACA_PAPER_BROKER_SECRET_KEY'),
            sandbox=True # Hardcoded to sandbox for simplicity
        )
    except Exception as init_error:
        logging.critical(f"Initialization failed: {init_error}")
        broker_client = None # Prevent function execution if init fails
        return https_fn.Response(json.dumps({"error": f"{init_error}"}), status=500, content_type="application/json")

    agent_ref = None
    agent_id = None
    user_id = None

    try:
        # 1. Auth
        id_token = req.headers.get('Authorization', '')
        if not id_token:
            return https_fn.Response(json.dumps({"error": "Unauthorized request"}), status=401, content_type="application/json")
        decoded_token = auth.verify_id_token(id_token)
        user_id = decoded_token['uid']

        # 2. Parse Request
        request_json = req.get_json(silent=True)
        agent_id = request_json.get('agentId') if request_json else None
        if not agent_id:
            return https_fn.Response(json.dumps({"error": "No valid JSON in request"}), status=400, content_type="application/json")

        # 3. Get Agent & Update Status (Start)
        agent_ref = db.reference(f'creators/{user_id}/agents/{agent_id}')
        agent_data = agent_ref.get()
        if not agent_data:
            return https_fn.Response(json.dumps({"error": "Agent not found"}), status=404, content_type="application/json")
        # Optional: Check if already done (uncomment if needed)
        if agent_data.get('status') in ['account_registered', 'registering_account']:
            return https_fn.Response(json.dumps({"message": f"Agent status is {agent_data.get('status')}"}), status=200, content_type="application/json")

        agent_ref.update({'status': 'registering_account', 'accountRegistrationStarted': datetime.now().isoformat()})

        # 4. Prepare Alpaca Data (!!! CRITICAL: REPLACE PLACEHOLDERS !!!)
        client_ip = req.headers.get('X-Forwarded-For', '1.1.1.1').split(',')[0].strip()
        now_iso = datetime.now(timezone.utc).isoformat() # Use timezone-aware UTC timestamp

        # --- !!! VITAL: This data MUST be replaced with dynamic, real info !!! ---
        contact = Contact(
            email_address=f"agent-{agent_id}-user-{user_id}@spookylabs.ai", # Hardcoded domain
            phone_number="5550000000", street_address=["123 Placeholder Ln"],
            city="Seattle", state="WA", postal_code="98101", country="USA"
        )
        identity = Identity(
            given_name=agent_id, family_name=user_id, date_of_birth="1990-01-01",
            tax_id="987010123", tax_id_type=TaxIdType.USA_SSN, country_of_citizenship="USA", # Avoiding 00 group
            country_of_birth="USA", country_of_tax_residence="USA",
            funding_source=[FundingSource.EMPLOYMENT_INCOME]
        )
        # --- !!! End of Placeholder Data Section !!! ---

        disclosures = Disclosures(is_control_person=False, is_affiliated_exchange_or_finra=False,
                                is_politically_exposed=False, immediate_family_exposed=False)
        agreements = [
            Agreement(agreement=AgreementType.ACCOUNT, signed_at=now_iso, ip_address=client_ip),
            Agreement(agreement=AgreementType.CUSTOMER, signed_at=now_iso, ip_address=client_ip),
            Agreement(agreement=AgreementType.CRYPTO, signed_at=now_iso, ip_address=client_ip) # Optional
        ]

        # 5. Create Alpaca Account
        logger.info(f"Creating Alpaca account for agent {agent_id} (User: {user_id})")
        account_creation_request = CreateAccountRequest(
            contact=contact, identity=identity, disclosures=disclosures, agreements=agreements
        )
        account = broker_client.create_account(account_creation_request)
        account_id = account.id
        account_given_name = account.identity.given_name
        account_family_name = account.identity.family_name
        account_owner_name = f"{account_given_name} {account_family_name}"
        bank_account_number = "123456789012"
        bank_routing_number = "121000358"

        ach_data = CreateACHRelationshipRequest(
                    account_owner_name=account_owner_name,
                    bank_account_type=BankAccountType.CHECKING,
                    bank_account_number=bank_account_number,
                    bank_routing_number=bank_routing_number,
                )
        
        ach_relationship = broker_client.create_ach_relationship_for_account(
                    account_id=account_id,
                    ach_data=ach_data
                )
        relationship_id = ach_relationship.id

        # 6. Update Agent Status (Success)
        agent_ref.update({
            'status': 'account_registered',
            'alpacaAccount': {
                'id': str(account.id),
                'status': account.status,
                'created_at': account.created_at.isoformat() if isinstance(account.created_at, datetime) else account.created_at,
                'account_funding_status': 'PENDING',
                'relationship_id': str(relationship_id)    # Store for later use, convert UUID to string
            },
            'accountRegistrationCompleted': datetime.now().isoformat(),
            'error': None # Clear previous error
        })
        logger.info(f"Success for agent {agent_id}. Alpaca ID: {account.id}")

        # 7. Return Success
        return https_fn.Response(json.dumps({"success": True, 
                                             "agentId": agent_id,
                                             "userId": user_id,
                                             "accountId": str(account.id),  # Convert UUID to string
                                             "accountStatus": account.status,
                                             "fundingStatus": "PENDING"}), 
                                             status=200, 
                                             content_type="application/json")

    except Exception as e:
        logger.error(f"Error for agent {agent_id} (User: {user_id}): {e}", exc_info=True) # Log stack trace
        # Update agent status to failed if possible
        if agent_ref:
            try:
                agent_ref.update({'status': 'account_registration_failed', 'error': str(e)})
            except Exception as db_err:
                logger.error(f"Failed to update agent status after error: {db_err}")
        return https_fn.Response(json.dumps({"error": "Account registration failed"}), status=500, content_type="application/json")
    

