import os
import json
import logging
import firebase_admin
from datetime import datetime, timezone

from firebase_admin import db, auth
from firebase_functions import https_fn, options

from alpaca.broker.client import BrokerClient
from alpaca.broker.requests import CreateACHTransferRequest
from alpaca.broker.enums import TransferDirection, TransferTiming


# Check if already initialized to avoid re-initialization
try:
    app = firebase_admin.get_app()
except ValueError:
    # App doesn't exist, initialize it
    app = firebase_admin.initialize_app()

logger = logging.getLogger("cloud_functions")

@https_fn.on_request(secrets=["ALPACA_BROKER_API_KEY", "ALPACA_BROKER_SECRET_KEY"], cors=options.CorsOptions(cors_origins=["*"], cors_methods=["post", "options"]))
def fundAccount(req: https_fn.Request) -> https_fn.Response:
    """Fund an existing Alpaca paper trading account using just agent_id."""
    try:
        broker_client = BrokerClient(
            api_key=os.environ.get('ALPACA_BROKER_API_KEY'),
            secret_key=os.environ.get('ALPACA_BROKER_SECRET_KEY'),
            sandbox=True
        )

        id_token = req.headers.get('Authorization', '')
        if not id_token:
            return https_fn.Response(json.dumps({"error": "Unauthorized"}), status=401, content_type="application/json")
        decoded_token = auth.verify_id_token(id_token)
        user_id = decoded_token['uid']

        request_json = req.get_json(silent=True)
        if not request_json:
            return https_fn.Response(json.dumps({"error": "Missing request body"}), status=400, content_type="application/json")

        agent_id = request_json.get('agentId')
        if not agent_id:
            return https_fn.Response(json.dumps({"error": "Missing agentId parameter"}), status=400, content_type="application/json")

        agent_ref = db.reference(f'creators/{user_id}/agents/{agent_id}')
        agent_data = agent_ref.get()

        if not agent_data:
            return https_fn.Response(json.dumps({"error": "Agent not found"}), status=404, content_type="application/json")

        alpaca_account = agent_data.get('alpacaAccount', {})
        account_id = alpaca_account.get('id')
        relationship_id = alpaca_account.get('relationship_id')

        if not account_id or not relationship_id:
            return https_fn.Response(json.dumps({"error": "Agent has no linked Alpaca account"}), status=400, content_type="application/json")

        current_funding_status = alpaca_account.get('account_funding_status')
        if current_funding_status == 'FUNDED':
            return https_fn.Response(json.dumps({"message": "Account already funded"}), status=200, content_type="application/json")

        agent_ref.update({'alpacaAccount/account_funding_status': 'FUNDING'})

        transfer = broker_client.create_transfer_for_account(
            account_id=account_id,
            transfer_data=CreateACHTransferRequest(
                relationship_id=relationship_id,
                direction=TransferDirection.INCOMING,
                amount="25000",
                timing=TransferTiming.IMMEDIATE
            )
        )

        agent_ref.update({
            'alpacaAccount/transfer_id': str(transfer.id),
            'alpacaAccount/account_funding_status': 'FUNDED',
            'alpacaAccount/funding_amount': "25000",
            'accountFundingCompleted': datetime.now(timezone.utc).isoformat()
        })

        return https_fn.Response(
            json.dumps({
                "success": True,
                "transferId": str(transfer.id),
                "amount": "$25,000.00",
                "status": "COMPLETE"
            }),
            status=200,
            content_type="application/json"
        )

    except Exception as e:
        error_message = str(e)
        if "QUEUED" in error_message:
            return https_fn.Response(
                json.dumps({
                    "error": "RELATIONSHIP_NOT_READY",
                    "message": "The ACH relationship is still being processed. Please try again in a few minutes."
                }),
                status=400,
                content_type="application/json"
            )
        else:
            logger.error(f"Funding error: {e}", exc_info=True)
            return https_fn.Response(
                json.dumps({"error": "FUNDING_FAILED", "message": error_message}),
                status=500,
                content_type="application/json"
            )