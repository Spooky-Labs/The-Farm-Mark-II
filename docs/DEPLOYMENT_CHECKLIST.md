# Deployment Checklist

## Pre-Deployment

- [ ] **Update .firebaserc** with your actual project ID
  ```bash
  firebase use the-farm-neutrino-315cd
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

- [ ] **Verify Firebase Storage bucket exists**
  ```bash
  gsutil ls gs://the-farm-neutrino-315cd.firebasestorage.app
  ```
  Note: The project uses a single Firebase Storage bucket for all operations

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
  - Should be: `https://submitagent-emedpldi5a-uc.a.run.app` (Gen 2 function URL)

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
1. Check `functions/index.js` exports both functions
2. Verify `functions/package.json` exists
3. Check Node version: `node --version` (should be 20+ as Node 18 is deprecated)

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