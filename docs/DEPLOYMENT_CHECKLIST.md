# Deployment Checklist

## Pre-Deployment

- [ ] **Update .firebaserc** with your actual project ID
  ```bash
  firebase use the-farm-neutrino-315cd
  ```

- [ ] **Install dependencies**
  ```bash
  # JavaScript functions
  cd functions && npm install && cd ..

  # Python functions
  cd python-functions
  python3.12 -m venv venv
  source venv/bin/activate  # On Windows: venv\Scripts\activate
  pip install -r requirements.txt
  deactivate
  cd ..
  ```

- [ ] **Enable required APIs in Google Cloud Console**
  - [ ] Cloud Functions API
  - [ ] Cloud Storage API
  - [ ] Cloud Build API
  - [ ] Firebase Realtime Database
  - [ ] Secret Manager API (for Alpaca API keys)

- [ ] **Verify Firebase Storage bucket exists**
  ```bash
  gsutil ls gs://the-farm-neutrino-315cd.firebasestorage.app
  ```
  Note: The project uses a single Firebase Storage bucket for all operations

- [ ] **Verify Firebase Authentication is enabled**
  - Go to Firebase Console → Authentication → Sign-in method
  - Enable at least one provider (e.g., Email/Password)

- [ ] **Set up Firebase Secrets (for Python functions)**
  ```bash
  # Required for Alpaca integration
  firebase functions:secrets:set ALPACA_BROKER_API_KEY
  firebase functions:secrets:set ALPACA_BROKER_SECRET_KEY
  ```

## Deployment

- [ ] **Test locally first (optional)**
  ```bash
  firebase emulators:start
  ```

- [ ] **Deploy to Firebase**
  ```bash
  firebase deploy
  ```

  Or just functions:
  ```bash
  firebase deploy --only functions
  ```

## Post-Deployment Verification

- [ ] **Check function deployment**
  ```bash
  firebase functions:list
  ```

- [ ] **Verify function URLs (All Gen 2 Cloud Run)**
  - JavaScript functions:
    - submitAgent: `https://submitagent-emedpldi5a-uc.a.run.app`
    - updateAgentMetadata: (Storage trigger, no URL)
  - Python functions:
    - createAccount: `https://createaccount-emedpldi5a-uc.a.run.app`
    - fundAccount: `https://fundaccount-emedpldi5a-uc.a.run.app`

- [ ] **Test the endpoint**
  ```bash
  # Get a test token from Firebase Console or your app
  curl -X POST \
    https://submitagent-emedpldi5a-uc.a.run.app \
    -H "Authorization: Bearer YOUR_ID_TOKEN" \
    -F "files=@test-file.py"
  ```

- [ ] **Check logs for any errors**
  ```bash
  firebase functions:log --only submitAgent
  ```

- [ ] **Verify storage trigger**
  - Upload a file via the API
  - Check if `updateAgentMetadata` function triggered
  - Verify database entry created at `/agents/{userId}/{agentId}`

## Common Issues

### If deployment fails:
1. Check you're logged in: `firebase login`
2. Verify project exists: `firebase projects:list`
3. Check billing is enabled in Google Cloud Console
4. Run with debug: `firebase deploy --debug`

### If functions don't appear:
1. For JavaScript: Check `functions/index.js` exports all functions
2. For Python: Check `python-functions/main.py` imports all functions
3. Verify both `functions/package.json` and `python-functions/requirements.txt` exist
4. Check Node version: `node --version` (should be 20+)
5. Check Python version: `python3.12 --version` (should be 3.12+)

### If storage trigger doesn't fire:
1. Verify bucket name is correctly set to `the-farm-neutrino-315cd.firebasestorage.app` in both functions
2. Check firebase-admin version in package.json (needs 9.7.0+)
3. Ensure Firebase Storage is initialized and has proper permissions

## Ready to Deploy?

If all boxes are checked, run:
```bash
firebase deploy
```

Good luck! 🚀