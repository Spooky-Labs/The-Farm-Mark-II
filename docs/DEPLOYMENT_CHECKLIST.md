# Deployment Checklist

## Pre-Deployment

- [ ] **Update .firebaserc** with your actual project ID
  ```bash
  firebase use YOUR-PROJECT-ID
  ```

- [ ] **Install dependencies**
  ```bash
  cd functions && npm install && cd ..
  ```

- [ ] **Enable required APIs in Google Cloud Console**
  - [ ] Cloud Functions API
  - [ ] Cloud Storage API
  - [ ] Cloud Build API
  - [ ] Firebase Realtime Database

- [ ] **Create storage bucket**
  ```bash
  gsutil mb gs://YOUR-PROJECT-ID-agent-code
  ```
  Note: Only one bucket needed - backtest results go to Realtime Database

- [ ] **Verify Firebase Authentication is enabled**
  - Go to Firebase Console → Authentication → Sign-in method
  - Enable at least one provider (e.g., Email/Password)

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
  firebase functions:log --limit 10
  ```

- [ ] **Verify function URL**
  - Should be: `https://us-central1-YOUR-PROJECT-ID.cloudfunctions.net/submitAgent`

- [ ] **Test the endpoint**
  ```bash
  # Get a test token from Firebase Console or your app
  curl -X POST \
    https://us-central1-YOUR-PROJECT-ID.cloudfunctions.net/submitAgent \
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
1. Check `functions/index.js` exports both functions
2. Verify `functions/package.json` exists
3. Check Node version: `node --version` (should be 18+)

### If storage trigger doesn't fire:
1. Verify bucket name matches pattern: `{projectId}-agent-code`
2. Check firebase-admin version in package.json (needs 9.7.0+)
3. Ensure storage rules allow writes

## Ready to Deploy?

If all boxes are checked, run:
```bash
firebase deploy
```

Good luck! 🚀