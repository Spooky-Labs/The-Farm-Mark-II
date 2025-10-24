# Fix Firebase Tools Update Error

## Quick Solution (Try This First)

```bash
# 1. Kill any running Firebase processes
killall node 2>/dev/null || true
killall firebase 2>/dev/null || true

# 2. Clear npm cache
npm cache clean --force

# 3. Remove the problematic directory
sudo rm -rf /Users/nonplus/.nvm/versions/node/v22.14.0/lib/node_modules/firebase-tools
sudo rm -rf /Users/nonplus/.nvm/versions/node/v22.14.0/lib/node_modules/.firebase-tools-*

# 4. Reinstall firebase-tools
npm install -g firebase-tools
```

## Alternative Solution (If Above Doesn't Work)

### Method 1: Use sudo for global install
```bash
# Uninstall first
sudo npm uninstall -g firebase-tools

# Clear npm cache
npm cache clean --force

# Reinstall with sudo
sudo npm install -g firebase-tools
```

### Method 2: Install without -g (local to project)
```bash
# Install firebase-tools locally in your project
cd /Users/nonplus/Documents/Spooky\ Labs/The\ Farm\ Mark\ II
npm install firebase-tools

# Use it with npx
npx firebase login
npx firebase deploy
```

### Method 3: Complete npm cleanup
```bash
# 1. Remove all firebase-tools remnants
rm -rf ~/.npm/_cacache
rm -rf /Users/nonplus/.nvm/versions/node/v22.14.0/lib/node_modules/firebase-tools
rm -rf /Users/nonplus/.nvm/versions/node/v22.14.0/lib/node_modules/.firebase-tools-*

# 2. Check for any running Firebase processes
ps aux | grep firebase
# Kill any processes you find with: kill -9 [PID]

# 3. Reinstall
npm install -g firebase-tools
```

## Using Yarn Instead (Alternative Package Manager)

If npm continues to have issues:

```bash
# Install yarn
npm install -g yarn

# Install firebase-tools with yarn
yarn global add firebase-tools
```

## Verify Installation

After successful installation:

```bash
# Check version
firebase --version

# Login
firebase login

# List projects
firebase projects:list
```

## Prevention Tips

1. **Always stop emulators** before updating:
   ```bash
   # Press Ctrl+C in emulator terminal
   # Or kill processes
   killall node
   ```

2. **Update regularly** to avoid large version jumps:
   ```bash
   npm update -g firebase-tools
   ```

3. **Use npx** for one-off commands (no install needed):
   ```bash
   npx firebase-tools --version
   ```

## If Nothing Works

As a last resort, you can use the standalone binary:

```bash
# Download standalone binary
curl -sL https://firebase.tools | bash

# This installs to /usr/local/bin/firebase
# Use it directly:
firebase --version
```

## For Your Current Project

Since you're trying to deploy, you can also use npx without installing globally:

```bash
# From your project directory
cd /Users/nonplus/Documents/Spooky\ Labs/The\ Farm\ Mark\ II

# Use npx to run firebase commands
npx firebase-tools login
npx firebase-tools use [your-project-id]
npx firebase-tools deploy
```

This avoids the global installation issue entirely!