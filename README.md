# @fermion-app/sandbox

A TypeScript SDK for creating and managing isolated code execution environments. This SDK provides a high-level interface to create containers, execute commands, and manage files in secure sandbox environments.

## Features

- 🚀 Create isolated sandbox containers on-demand
- 💻 Execute commands with streaming or complete output
- 📁 File operations (read, write) with binary support
- 🌐 Public URLs for ports 3000, 1337, 1338 - run web servers and share instantly
- 🔌 WebSocket-based real-time communication
- ♻️ Automatic reconnection and health monitoring
- 📦 Full TypeScript support with detailed JSDoc
- 🎯 Type-safe API with discriminated unions

## Installation

```bash
npm install @fermion-app/sandbox
```

Or with yarn:

```bash
yarn add @fermion-app/sandbox
```

Or with pnpm:

```bash
pnpm add @fermion-app/sandbox
```

## Quick Start

```typescript
import { Sandbox } from '@fermion-app/sandbox'

// Create a sandbox
const sandbox = await Sandbox.create({
  apiKey: 'your-api-key'
})

// Execute a command
const result = await sandbox.runCommand({
  cmd: 'node',
  args: ['--version']
})
console.log(result.stdout)

// Write a file
await sandbox.setFile({
  path: '/home/user/script.js',
  content: 'console.log("Hello World")'
})

// Read a file
const fileBuffer = await sandbox.getFile('/home/user/script.js')
const text = new TextDecoder().decode(fileBuffer)
console.log(text)

// Clean up
await sandbox.disconnect()
```

## API Reference

### `Sandbox.create(options)`

Creates and initializes a new sandbox instance.

**Parameters:**
- `options.apiKey` (string, **required**): API key for authentication
- `options.gitRepoUrl` (string, optional): Git repository URL to clone on startup
- `options.shouldBackupFilesystem` (boolean, optional): Whether to persist filesystem after shutdown

**Returns:** `Promise<Sandbox>` - A fully initialized sandbox instance

**Throws:**
- Error if container provisioning times out (30 seconds)
- Error if session creation fails

**Example:**
```typescript
const sandbox = await Sandbox.create({
  apiKey: 'your-key',
  gitRepoUrl: 'https://github.com/user/repo.git',
  shouldBackupFilesystem: true
})
```

### Instance Methods

#### `runCommand(options): Promise<{ stdout: string; stderr: string }>`

Executes a short command and waits for completion.

**Use case:** Quick commands that complete within seconds (file operations, simple scripts)

**Parameters:**
- `options.cmd` (string, required): Command to execute
- `options.args` (string[], optional): Command arguments

**Returns:** `Promise<{ stdout: string; stderr: string }>`

**Example:**
```typescript
const result = await sandbox.runCommand({
  cmd: 'ls',
  args: ['-la', '/home/user']
})
console.log(result.stdout)
console.log(result.stderr)
```

#### `runStreamingCommand(options): Promise<void>`

Executes a long-running command with streaming output.

**Use case:** Build processes, servers, watchers, or any command with continuous output

**Parameters:**
- `options.cmd` (string, required): Command to execute
- `options.args` (string[], required): Command arguments
- `options.stdin` (string, optional): Standard input to pipe to the command
- `options.onStdout` ((data: string) => void, optional): Callback for stdout chunks
- `options.onStderr` ((data: string) => void, optional): Callback for stderr chunks
- `options.onClose` ((exitCode: number) => void, optional): Callback when command exits

**Returns:** `Promise<void>` - Resolves when command starts (not when it finishes)

**Example:**
```typescript
await sandbox.runStreamingCommand({
  cmd: 'npm',
  args: ['install'],
  onStdout: (data) => console.log('OUT:', data),
  onStderr: (data) => console.error('ERR:', data),
  onClose: (code) => console.log('Exit code:', code)
})
```

#### `getFile(path: string): Promise<ArrayBuffer>`

Retrieves a file from the container filesystem.

**Parameters:**
- `path` (string, required): Absolute path to the file

**Returns:** `Promise<ArrayBuffer>` - File contents as ArrayBuffer

**Throws:**
- Error if file not found (404)
- Error if container not initialized

**Example:**
```typescript
// Read text file
const buffer = await sandbox.getFile('/home/user/output.txt')
const text = new TextDecoder().decode(buffer)

// Read binary file
const imageBuffer = await sandbox.getFile('/home/user/image.png')
```

#### `setFile(options): Promise<void>`

Writes a file to the container filesystem.

**Parameters:**
- `options.path` (string, required): Absolute path where file should be written
- `options.content` (string | ArrayBuffer, required): File content

**Throws:**
- Error if container not initialized
- Error if write fails

**Example:**
```typescript
// Write text file
await sandbox.setFile({
  path: '/home/user/script.js',
  content: 'console.log("Hello")'
})

// Write binary file
const buffer = new Uint8Array([1, 2, 3, 4]).buffer
await sandbox.setFile({
  path: '/home/user/data.bin',
  content: buffer
})
```

#### `disconnect(): Promise<void>`

Disconnects from the container and cleans up resources.

**Important:** Always call this when done to free up resources.

**Example:**
```typescript
await sandbox.disconnect()
```

#### `isConnected(): boolean`

Checks if the WebSocket connection is active.

**Returns:** `boolean` - true if connected, false otherwise

#### `getSessionId(): string | null`

Gets the current playground session ID.

**Returns:** `string | null` - Session ID or null if not initialized

#### `getContainerDetails(): ContainerDetails | null`

Gets the container connection details.

**Returns:** `ContainerDetails | null` - Details including subdomain and access token, or null if not initialized

#### `getPublicUrl(port: number): string`

Gets the public URL for a specific port.

**Parameters:**
- `port` (number, required): Port number - must be 3000, 1337, or 1338

**Returns:** `string` - Public HTTPS URL for the specified port

**Throws:**
- Error if container not initialized
- Error if port is not supported

**Example:**
```typescript
// Start a web server on port 3000
await sandbox.runStreamingCommand({
  cmd: 'node',
  args: ['-e', 'require("http").createServer((req,res) => res.end("Hello")).listen(3000)']
})

// Get the public URL
const url = sandbox.getPublicUrl(3000)
console.log(`Visit: ${url}`)
// Output: https://abc123-3000.run-code.com
```

#### `exportPort(port: 3000 | 1337 | 1338): Promise<string>`

Exports a port to the public internet.

**Parameters:**
- `port` (number, required): Port number - must be 3000, 1337, or 1338

**Returns:** `Promise<string>` - Public HTTPS URL for the specified port

## Complete Examples

### Deploying a Web Application with Public URL

```typescript
import { Sandbox } from '@fermion-app/sandbox'

const sandbox = await Sandbox.create({
  apiKey: process.env.FERMION_API_KEY
})

// Create a simple Express server
await sandbox.setFile({
  path: '/home/user/server.js',
  content: `
    const http = require('http');
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Hello from Fermion Sandbox!</h1>');
    });
    server.listen(3000, () => {
      console.log('Server running on port 3000');
    });
  `
})

// Start the server in background
await sandbox.runStreamingCommand({
  cmd: 'node',
  args: ['server.js'],
  onStdout: (data) => console.log(data.trim()),
  onStderr: (data) => console.error(data.trim())
})

// Get the public URL
const publicUrl = sandbox.getPublicUrl(3000)
console.log(`🚀 Your app is live at: ${publicUrl}`)

// Or get all available URLs
const allUrls = sandbox.getPublicUrls()
console.log('Available ports:', allUrls)

// Keep the sandbox running...
// When done: await sandbox.disconnect()
```

### Running a Build Process

```typescript
import { Sandbox } from '@fermion-app/sandbox'

const sandbox = await Sandbox.create({
  apiKey: process.env.FERMION_API_KEY,
  gitRepoUrl: 'https://github.com/user/node-app.git'
})

// Install dependencies with streaming output
await sandbox.runStreamingCommand({
  cmd: 'npm',
  args: ['install'],
  onStdout: (data) => process.stdout.write(data),
  onClose: (code) => {
    if (code === 0) console.log('✓ Dependencies installed')
  }
})

// Run build
const buildResult = await sandbox.runCommand({
  cmd: 'npm',
  args: ['run', 'build']
})

if (buildResult.stderr) {
  console.error('Build errors:', buildResult.stderr)
}

// Get build output
const distFiles = await sandbox.getFile('/home/user/dist/index.js')
console.log(new TextDecoder().decode(distFiles))

await sandbox.disconnect()
```

### Processing Files

```typescript
const sandbox = await Sandbox.create({
  apiKey: process.env.FERMION_API_KEY
})

// Write input data
await sandbox.setFile({
  path: '/home/user/input.json',
  content: JSON.stringify({ data: [1, 2, 3] })
})

// Create processing script
await sandbox.setFile({
  path: '/home/user/process.js',
  content: `
    const fs = require('fs')
    const data = JSON.parse(fs.readFileSync('input.json', 'utf8'))
    const result = data.data.map(x => x * 2)
    fs.writeFileSync('output.json', JSON.stringify(result))
  `
})

// Execute
await sandbox.runCommand({
  cmd: 'node',
  args: ['process.js']
})

// Read result
const resultBuffer = await sandbox.getFile('/home/user/output.json')
const result = JSON.parse(new TextDecoder().decode(resultBuffer))
console.log(result) // [2, 4, 6]

await sandbox.disconnect()
```

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Run the example
pnpm test

# Type check
pnpm typecheck

# Lint code
pnpm lint
```

### Project Structure

```
fermion-sandbox/
├── src/
│   ├── index.ts        # Main Sandbox class
│   ├── websocket.ts    # WebSocket communication layer
│   ├── api-client.ts   # HTTP API client
│   ├── constants.ts    # Type definitions
│   └── example.ts      # Usage examples
├── dist/               # Compiled output (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## How It Works

1. **Provisioning**: When you call `Sandbox.create()`, the SDK:
   - Creates a playground snippet via HTTP API
   - Starts a playground session
   - Polls until container is ready (30s timeout)
   - Establishes WebSocket connection
   - Optionally clones git repository

2. **Communication**: The SDK uses:
   - **HTTP (HTTPS)** for file operations via static-server endpoint
   - **WebSocket (WSS)** for command execution and real-time events
   - **Health pings** every 30 seconds to keep connections alive
   - **Automatic reconnection** if connection drops

3. **Command Execution**:
   - **Quick commands** (`runCommand`): Request → Complete response
   - **Streaming commands** (`runStreamingCommand`): Start → Stream events → Close event

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions:

```typescript
import type {
  Sandbox,
  WebSocketRequestPayload,
  WebSocketResponsePayload,
  ContainerDetails
} from '@fermion-app/sandbox'
```

All methods are fully documented with JSDoc for IntelliSense support.

## Error Handling

The SDK throws descriptive errors:

```typescript
try {
  const sandbox = await Sandbox.create({
    apiKey: 'invalid-key'
  })
} catch (error) {
  if (error.message.includes('Provisioning timeout')) {
    console.error('Container took too long to start')
  }
}
```

## License

MIT

## Support

For issues and questions, please open an issue on the GitHub repository.
