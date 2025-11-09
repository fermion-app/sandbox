# Hello World Cookbook

Basic introduction to Fermion Sandbox demonstrating sandbox creation, command execution, and file operations.

## Quick Start

### Option 1: Run directly

```bash
# Install dependencies
npm install

# Create .env file (optional)
echo "FERMION_API_KEY=your-api-key" > .env

# Run
npm start
```

Or set environment variable inline:
```bash
FERMION_API_KEY=your-api-key npm start
```

### Option 2: Copy code to your project

Copy the code from `index.ts` into your own project and install:

```bash
npm install @fermion-app/sandbox
```

### Option 3: Use as template

Copy this entire folder and modify `index.ts` for your needs.

## What it does

- Creates a sandbox container
- Writes a JavaScript file
- Reads the file back
- Executes the file
- Lists files in the home directory

## Requirements

- Node.js (v18+)
- Fermion API key ([Get yours here](https://fermion.app))

