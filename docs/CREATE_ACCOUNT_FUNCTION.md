# Alpaca Account Registration Function

## Overview

The `register_alpaca_account` function creates broker accounts through Alpaca's API, enabling users to set up trading accounts for their agents. This is a Python-based Cloud Function that integrates with Firebase Authentication and Realtime Database.

## Setup Requirements

### 1. Environment Variables

Set these in Firebase Functions configuration:

```bash
# Set Alpaca API credentials
firebase functions:config:set \
  alpaca.broker_api_key="YOUR_ALPACA_BROKER_API_KEY" \
  alpaca.broker_secret_key="YOUR_ALPACA_BROKER_SECRET_KEY" \
  alpaca.sandbox="true"  # Set to "false" for production
```

Or using the newer secrets management:

```bash
firebase functions:secrets:set ALPACA_BROKER_API_KEY
firebase functions:secrets:set ALPACA_BROKER_SECRET_KEY
```

### 2. Alpaca Broker Account

1. Sign up for an Alpaca Broker account at https://broker.alpaca.markets
2. Get your API credentials from the dashboard
3. Use sandbox credentials for testing, production credentials for live trading

## Function Details

- **Endpoint**: `https://registeralpacaaccount-[hash]-uc.a.run.app`
- **Method**: POST
- **Authentication**: Required (Firebase ID Token)
- **Region**: us-central1

## Request Format

### Headers
```
Authorization: Bearer YOUR_FIREBASE_ID_TOKEN
Content-Type: application/json
```

### Request Body

```json
{
  "agentId": "agent_123",
  "contact": {
    "email": "user@example.com",
    "phone": "+12125551234",
    "street": ["123 Main St", "Apt 4B"],
    "city": "New York",
    "state": "NY",
    "postal_code": "10001"
  },
  "identity": {
    "given_name": "John",
    "family_name": "Doe",
    "date_of_birth": "1990-01-15",
    "tax_id": "123456789",
    "country_of_citizenship": "USA",
    "country_of_birth": "USA",
    "country_of_tax_residence": "USA"
  },
  "disclosures": {
    "is_control_person": false,
    "is_affiliated_exchange_or_finra": false,
    "is_politically_exposed": false,
    "immediate_family_exposed": false
  },
  "agreements": [
    {
      "agreement": "margin_agreement",
      "signed_at": "2024-01-01T00:00:00Z",
      "ip_address": "192.168.1.1"
    },
    {
      "agreement": "crypto_agreement",
      "signed_at": "2024-01-01T00:00:00Z",
      "ip_address": "192.168.1.1"
    }
  ],
  "banking": {
    "account_number": "123456789",
    "routing_number": "121000358",
    "bank_account_type": "CHECKING"
  }
}
```

## Response Format

### Success Response (201)
```json
{
  "success": true,
  "account_id": "alpaca-account-id",
  "account_number": "account-number",
  "status": "ACTIVE",
  "funding_status": "PENDING",
  "message": "Alpaca account created successfully (sandbox)"
}
```

### Error Responses

#### 401 Unauthorized
```json
{
  "error": "Unauthorized"
}
```

#### 400 Bad Request
```json
{
  "error": "Missing required fields"
}
```

#### 500 Internal Server Error
```json
{
  "error": "Failed to create account",
  "message": "Specific error message"
}
```

## Database Structure

The function updates Firebase Realtime Database in multiple locations:

```
/alpaca_accounts/{userId}/{agentId}
/agents/{userId}/{agentId}/alpaca_account
/users/{userId}/alpaca_accounts/{agentId}
```

Each entry contains:
- `alpaca_account_id`: The Alpaca account ID
- `alpaca_account_number`: The account number
- `status`: Account status (ACTIVE, PENDING, etc.)
- `created_at`: Creation date
- `sandbox`: Boolean indicating if sandbox account
- `user_id`: Firebase user ID
- `agent_id`: Associated agent ID
- `ach_relationship_id`: Bank connection ID (if banking provided)
- `funding_status`: Status of bank funding

## Important Security Notes

1. **Never hardcode sensitive data** - All personal information must come from the user
2. **Validate SSN/Tax ID format** before sending to Alpaca
3. **Use sandbox for testing** - Always test with sandbox credentials first
4. **Implement rate limiting** - Alpaca has API rate limits
5. **Store minimal data** - Only store IDs and status in your database

## Testing

### 1. Test with cURL

```bash
# Get Firebase ID token from your app or Firebase Console
TOKEN="your-firebase-id-token"

# Create account
curl -X POST https://registeralpacaaccount-[hash]-uc.a.run.app \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "test_agent_1",
    "contact": {
      "email": "test@example.com",
      "phone": "+12125551234",
      "street": ["123 Test St"],
      "city": "New York",
      "state": "NY",
      "postal_code": "10001"
    },
    "identity": {
      "given_name": "Test",
      "family_name": "User",
      "date_of_birth": "1990-01-01",
      "tax_id": "123456789",
      "country_of_citizenship": "USA",
      "country_of_birth": "USA",
      "country_of_tax_residence": "USA"
    },
    "disclosures": {
      "is_control_person": false,
      "is_affiliated_exchange_or_finra": false,
      "is_politically_exposed": false,
      "immediate_family_exposed": false
    }
  }'
```

### 2. Test with JavaScript

```javascript
const createAlpacaAccount = async (agentId, userData) => {
  const idToken = await firebase.auth().currentUser.getIdToken();

  const response = await fetch('https://registeralpacaaccount-[hash]-uc.a.run.app', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      agentId,
      ...userData
    })
  });

  return response.json();
};
```

## Deployment

Deploy the Python functions:

```bash
firebase deploy --only functions:python-functions
```

Or deploy everything:

```bash
firebase deploy
```

## Compliance Considerations

1. **KYC (Know Your Customer)**: Collect all required identity information
2. **AML (Anti-Money Laundering)**: Implement proper verification
3. **Data Privacy**: Handle SSN and personal data securely
4. **Regulatory**: Follow FINRA and SEC requirements
5. **Age Verification**: Users must be 18+ years old

## Error Handling

The function includes comprehensive error handling:
- Authentication errors return 401
- Validation errors return 400
- Alpaca API errors are logged and return 500
- Database write failures are caught and reported

## Monitoring

Monitor function performance:

```bash
# View logs
firebase functions:log --only register_alpaca_account

# Check specific errors
firebase functions:log --only register_alpaca_account | grep ERROR
```

## Next Steps

1. Set up Alpaca webhook handlers for account status updates
2. Implement account verification status checking
3. Add funding status monitoring
4. Create account management functions (update, close, etc.)
5. Implement position and order management functions