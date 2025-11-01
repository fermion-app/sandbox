# @fermion-app/sandbox

Secure isolated code execution SDK for Node.js. Run untrusted code, build projects, or host services in ephemeral containers.

## Installation

```bash
npm install @fermion-app/sandbox
```

## Quick Start

```typescript
import { Sandbox } from '@fermion-app/sandbox'

// Create sandbox
const sandbox = new Sandbox({ apiKey: 'your-api-key' })
await sandbox.create({ shouldBackupFilesystem: false })

// Execute commands
const result = await sandbox.runCommand({
  cmd: 'node',
  args: ['--version']
})
console.log(result.stdout)

// Write and read files
await sandbox.writeFile({
  path: '~/script.js',
  content: 'console.log("Hello World")'
})

const response = await sandbox.getFile('~/script.js')
const content = await response.text()

// Clean up
await sandbox.disconnect()
```

## Key Features

- **Isolated containers** - Secure Linux environments for code execution
- **Real-time streaming** - WebSocket-based command output streaming
- **File operations** - Read/write files with binary support
- **Public URLs** - Expose ports 3000, 1337, 1338 for web services
- **Git support** - Clone repositories on container startup
- **TypeScript** - Full type safety and IntelliSense

## Core API

### Creating a Sandbox

```typescript
const sandbox = new Sandbox({ apiKey: 'your-api-key' })

// New container
await sandbox.create({
  shouldBackupFilesystem: false,  // Persist filesystem after shutdown
  gitRepoUrl: 'https://github.com/user/repo.git'  // Optional
})

// Or connect to existing
await sandbox.fromSnippet('snippet-id')
```

### Running Commands

```typescript
// Quick commands (< 5 seconds)
const { stdout, stderr } = await sandbox.runCommand({
  cmd: 'ls',
  args: ['-la']
})

// Long-running with streaming
const { stdout, stderr, exitCode } = await sandbox.runStreamingCommand({
  cmd: 'npm',
  args: ['install'],
  onStdout: (data) => console.log(data),
  onStderr: (data) => console.error(data)
})
```

### File Operations

```typescript
// Write file
await sandbox.writeFile({
  path: '~/app.js',
  content: 'console.log("Hello")'
})

// Read file
const response = await sandbox.getFile('~/app.js')
const text = await response.text()
const buffer = await response.arrayBuffer()
```

### Web Services

```typescript
// Start a server
await sandbox.runStreamingCommand({
  cmd: 'node',
  args: ['server.js']
})

// Get public URL
const url = await sandbox.exposePort(3000)
console.log(`Live at: ${url}`)
// https://abc123-3000.run-code.com
```

## Examples

### Run a Node.js Project

```typescript
const sandbox = new Sandbox({ apiKey: process.env.API_KEY })
await sandbox.create({
  gitRepoUrl: 'https://github.com/user/node-app.git'
})

// Install and build
await sandbox.runStreamingCommand({
  cmd: 'npm',
  args: ['install'],
  onStdout: (data) => process.stdout.write(data)
})

await sandbox.runCommand({
  cmd: 'npm',
  args: ['run', 'build']
})

// Start server
sandbox.runStreamingCommand({
  cmd: 'npm',
  args: ['start']
})

const url = await sandbox.exposePort(3000)
console.log(`App running at: ${url}`)
```

### Process Files

```typescript
// Upload input
await sandbox.writeFile({
  path: '~/input.json',
  content: JSON.stringify({ values: [1, 2, 3] })
})

// Process
await sandbox.runCommand({
  cmd: 'node',
  args: ['-e', `
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('input.json'));
    const result = data.values.map(x => x * 2);
    fs.writeFileSync('output.json', JSON.stringify(result));
  `]
})

// Get result
const response = await sandbox.getFile('~/output.json')
const result = await response.json()
console.log(result) // [2, 4, 6]
```

## API Reference

### Constructor
- `new Sandbox({ apiKey })` - Initialize client

### Methods
- `create(options)` - Create new container
- `fromSnippet(id)` - Connect to existing container
- `runCommand(options)` - Execute command (< 5s)
- `runStreamingCommand(options)` - Execute with streaming
- `writeFile(options)` - Write file to container
- `getFile(path)` - Read file from container
- `exposePort(port)` - Get public URL for port
- `disconnect()` - Clean up resources
- `isConnected()` - Check connection status

## File Paths

All paths must start with `~` (home) or `/home/damner/code`:
- `~/file.js` → `/home/damner/code/file.js`
- `/home/damner/code/app/index.js` → absolute path

## Supported Ports

Public URLs available for:
- Port 3000
- Port 1337
- Port 1338

## Error Handling

```typescript
try {
  await sandbox.create({ shouldBackupFilesystem: false })
} catch (error) {
  if (error.message.includes('Provisioning timeout')) {
    // Container took too long to start
  }
}
```

## Development

```bash
npm install    # Install dependencies
npm run build  # Build the package
npm test       # Run examples
```

## License

MIT

## Support

For issues and questions, visit [GitHub Issues](https://github.com/fermion-app/sandbox/issues).