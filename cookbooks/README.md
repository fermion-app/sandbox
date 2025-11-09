# Fermion Sandbox Cookbooks

Practical examples for common use cases with Fermion Sandbox. Each cookbook is self-contained and ready to run.

## Available Cookbooks

### [hello-world](./hello-world/)

Basic introduction demonstrating sandbox creation, command execution, and file operations.

### [openai-api-call](./openai-api-call/)

Integrate OpenAI API calls within a sandbox. Sets up Node.js environment, installs packages, and makes API calls.

### [code-execution-judge0](./code-execution-judge0/)

Code execution service using `quickRun` feature. Execute code in multiple languages (Python, Node.js, C++, Go, Rust, etc.) with input/output handling and resource usage tracking.

### [ai-code-interpreter](./ai-code-interpreter/)

AI-powered code interpreter using OpenAI function calling. The AI agent can execute Python code based on natural language requests.

## How to Use Cookbooks

### Method 1: Run Directly (Recommended for Learning)

Each cookbook is self-contained and ready to run:

```bash
cd hello-world
npm install
FERMION_API_KEY=your-key npm start
```

### Method 2: Copy Code to Your Project

1. Open any cookbook's `index.ts`
2. Copy the code you need
3. Paste into your project
4. Install dependencies: `npm install @fermion-app/sandbox`

### Method 3: Use as Template

1. Copy the entire cookbook folder
2. Rename and modify for your use case
3. Keep the original as reference

### Method 4: Reference Only

Read the code to understand patterns and concepts without running.

## Prerequisites

- Node.js (v18+)
- Fermion API key (get yours from [Fermion Dashboard](https://fermion.app))
- OpenAI API key (required for some cookbooks)

## Documentation

See [main README](../README.md) for full API documentation.
