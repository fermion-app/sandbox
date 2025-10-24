# Fermion Sandbox SDK

A standalone TypeScript/JavaScript SDK for creating and managing Fermion sandbox environments. This SDK allows you to programmatically create isolated container environments, execute commands, and manage files.

## Features

- Create isolated sandbox environments
- Execute commands in containers
- File management (read, write, delete)
- WebSocket-based real-time communication
- Automatic connection management and health pings
- Full TypeScript support

## Installation

```bash
npm install fermion-sandbox
```

Or with yarn:

```bash
yarn add fermion-sandbox
```

Or with pnpm:

```bash
pnpm add fermion-sandbox
```

## Quick Start

```typescript
import { Sandbox } from 'fermion-sandbox'

// Create a sandbox with a Git repository
const sandbox = await Sandbox.create({
  gitRepoUrl: 'https://github.com/your-username/your-repo'
})

// Execute a command
const result = await sandbox.runCommand({
  cmd: 'echo',
  args: ['Hello World!']
})

console.log(result.stdout) // "Hello World!"

// Write a file
await sandbox.setFile('/home/damner/code/test.txt', 'Hello from SDK!')

// Read a file
const content = await sandbox.getFile('/home/damner/code/test.txt')

// Clean up
sandbox.disconnect()
```

## API Reference

### `Sandbox.create(config: SandboxConfig): Promise<Sandbox>`

Creates and provisions a new sandbox instance.

**Parameters:**
- `config.gitRepoUrl` (string, required): Git repository URL to clone into the sandbox
- `config.fermionSchoolId` (string, optional): Your Fermion school ID
- `config.authToken` (string, optional): Authentication token
- `config.baseUrl` (string, optional): API base URL (defaults to production)
- `config.provisionTimeout` (number, optional): Timeout for provisioning in ms (default: 120000)

**Returns:** Promise that resolves to a connected Sandbox instance

### Instance Methods

#### `runCommand(options): Promise<{ stdout: string; stderr: string; exitCode: number }>`

Executes a command in the sandbox container.

**Parameters:**
- `options.cmd` (string, required): Command to execute
- `options.args` (string[], optional): Command arguments
- `options.stdin` (string, optional): Standard input to pass to the command

**Returns:** Promise with command output and exit code

**Example:**
```typescript
const result = await sandbox.runCommand({
  cmd: 'node',
  args: ['app.js'],
  stdin: 'some input'
})

console.log(result.stdout)
console.log(result.stderr)
console.log(result.exitCode)
```

#### `getFile(path: string): Promise<string>`

Reads a file from the sandbox.

**Parameters:**
- `path` (string): Absolute path to the file

**Returns:** Promise with file contents as a string

**Example:**
```typescript
const content = await sandbox.getFile('/home/damner/code/package.json')
```

#### `setFile(path: string, content: string): Promise<void>`

Writes or creates a file in the sandbox.

**Parameters:**
- `path` (string): Absolute path to the file
- `content` (string): File contents

**Example:**
```typescript
await sandbox.setFile('/home/damner/code/test.js', 'console.log("Hello")')
```

#### `delete(path: string): Promise<void>`

Deletes a file or folder from the sandbox.

**Parameters:**
- `path` (string): Absolute path to delete

**Example:**
```typescript
await sandbox.delete('/home/damner/code/temp.txt')
```

#### `disconnect(): void`

Disconnects from the sandbox and cleans up resources.

**Example:**
```typescript
sandbox.disconnect()
```

#### `isConnected(): boolean`

Checks if the sandbox is currently connected.

**Returns:** Boolean indicating connection status

#### `getSessionId(): string | null`

Gets the current playground session ID.

**Returns:** Session ID or null if not connected

#### `getContainerDetails(): ContainerDetails | null`

Gets the container connection details.

**Returns:** Container details or null if not provisioned

## Development

### Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run the example
npm run dev

# Type check
npm run typecheck
```

### Project Structure

```
fermion-sandbox/
├── src/
│   ├── index.ts        # Main Sandbox class
│   ├── websocket.ts    # WebSocket communication layer
│   └── example.ts      # Usage examples
├── dist/               # Compiled output (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## How It Works

1. **Provisioning**: When you call `Sandbox.create()`, the SDK:
   - Creates a new playground snippet
   - Starts a playground session
   - Waits for container provisioning
   - Establishes WebSocket connection

2. **Communication**: The SDK uses:
   - HTTP requests for file operations (via static-server endpoint)
   - WebSocket for command execution and real-time events
   - Automatic health pings to keep connections alive

3. **Command Execution**: Commands are executed via:
   - WebSocket message to start long-running command
   - Streaming events for stdout/stderr
   - Close event with exit code

## Common Paths

The default working directory in the sandbox is `/home/damner/code`. This is where your Git repository will be cloned.

## Error Handling

The SDK throws errors for common failure cases:

```typescript
try {
  const sandbox = await Sandbox.create({
    gitRepoUrl: 'https://github.com/invalid/repo'
  })
} catch (error) {
  console.error('Failed to create sandbox:', error.message)
}
```

## License

MIT

## Support

For issues and questions, please open an issue on the GitHub repository.
