# Setting Your Firebase Project ID

## Quick Fix

Replace `YOUR-PROJECT-ID` with your actual Firebase project ID.

### Step 1: Get Your Project ID

```bash
# List all your Firebase projects
firebase projects:list
```

You'll see output like:
```
┌──────────────────────┬─────────────────────┬────────────────┐
│ Project Display Name │ Project ID          │ Resource Loc   │
├──────────────────────┼─────────────────────┼────────────────┤
│ Spooky Trading       │ spooky-trading-123  │ us-central1    │
└──────────────────────┴─────────────────────┴────────────────┘
```

### Step 2: Set the Project

```bash
# Use your actual project ID from the list above
firebase use spooky-trading-123
```

This automatically updates `.firebaserc` with the correct project ID.

### Step 3: Verify

```bash
# Check it worked
firebase projects:list
```

You should see `(current)` next to your project.

## Project ID Requirements

Your Firebase project ID must:
- ✅ Be **all lowercase**
- ✅ Contain only letters, numbers, and hyphens
- ✅ Be between 6-30 characters
- ✅ Be globally unique

### Valid Examples:
- `spooky-trading-2024`
- `trading-platform-prod`
- `algo-trading-test`

### Invalid Examples:
- `YOUR-PROJECT-ID` ❌ (placeholder)
- `Spooky-Trading` ❌ (uppercase letters)
- `trading_platform` ❌ (underscores not allowed)
- `trade` ❌ (too short, minimum 6 characters)

## Creating a New Project (If Needed)

If you don't have a Firebase project yet:

```bash
# Create a new project
firebase projects:create spooky-trading-123

# Then use it
firebase use spooky-trading-123
```

## After Setting Project ID

Once you've set your project ID, you can:

1. **Deploy your functions:**
   ```bash
   firebase deploy
   ```

2. **Create your storage bucket:**
   ```bash
   gsutil mb gs://spooky-trading-123-agent-code
   ```

3. **Test locally:**
   ```bash
   firebase emulators:start
   ```

## Common Issues

### "Project not found"
- Make sure you're logged in: `firebase login`
- Verify the project exists: `firebase projects:list`

### "Permission denied"
- Check you have owner/editor role in the Google Cloud Console
- Ensure billing is enabled for the project

### "Invalid project ID"
- Must be all lowercase
- No spaces or special characters except hyphens
- Between 6-30 characters