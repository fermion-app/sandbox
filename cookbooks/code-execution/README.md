# Code Execution Service (Judge0 Alternative)

Code execution service using Fermion Sandbox's `quickRun` feature. Execute code in multiple languages with input/output handling and resource usage tracking.

## Setup

```bash
npm install
```

## Run

Create a `.env` file:
```bash
FERMION_API_KEY=your-key
```

Then run:
```bash
npm start
```

Or set environment variable inline:
```bash
FERMION_API_KEY=your-key npm start
```

## What it does

- Executes code in multiple languages (Python, Node.js, C++, Go, Rust, etc.)
- Handles stdin input and validates expected output
- Gets execution results with resource usage (CPU time, memory)
- Demonstrates error handling
- Provides a reusable code execution service helper function

## Supported Languages

Python, Node.js, C++, Go, Rust, Java, C, .NET

