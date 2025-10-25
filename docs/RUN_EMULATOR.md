# Running the Firebase Emulator

## Setup (First Time Only)

```bash
# 1. Install Firebase CLI if you haven't already
npm install -g firebase-tools

# 2. Install function dependencies
cd functions
npm install
cd ..
```

## Start the Emulator

```bash
firebase emulators:start
```

This will start:
- **Emulator UI**: http://localhost:4000
- **Auth**: http://localhost:9099
- **Functions**: http://localhost:5001
- **Database**: http://localhost:9000
- **Storage**: http://localhost:9199

## Testing submitAgent

1. Open the Emulator UI at http://localhost:4000
2. Go to the **Authentication** tab
3. Add a test user
4. Use the token to call the function:

```bash
curl -X POST \
  http://localhost:5001/the-farm-neutrino-315cd/us-central1/submitAgent \
  -H "Authorization: Bearer TOKEN_FROM_AUTH_TAB" \
  -F "files=@any-python-file.py"
```

Replace:
- `TOKEN_FROM_AUTH_TAB` with the token from the authenticated user
- `any-python-file.py` with your test file

## Stop the Emulator

Press `Ctrl+C` in the terminal where it's running.