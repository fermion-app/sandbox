# AI Code Interpreter Cookbook

AI-powered code interpreter using OpenAI function calling with Fermion Sandbox. The AI agent can execute Python code based on natural language requests.

## Setup

```bash
npm install
```

## Run

Create a `.env` file:
```bash
FERMION_API_KEY=your-key
OPENAI_API_KEY=sk-xxx
```

Then run:
```bash
npm start
```

Or set environment variables inline:
```bash
FERMION_API_KEY=your-key OPENAI_API_KEY=sk-xxx npm start
```

## What it does

- Uses OpenAI function calling to enable AI to execute Python code
- Executes Python code in isolated Fermion Sandbox
- Handles multi-turn conversations with context
- Installs data science packages (matplotlib, numpy, pandas, scipy)
- Demonstrates AI agent pattern for code execution

## How it works

1. User sends a natural language request
2. OpenAI decides to call the `execute_python` tool
3. Python code is executed in Fermion Sandbox
4. Results are returned to OpenAI
5. AI responds with analysis or next steps

