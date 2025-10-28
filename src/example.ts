import { Sandbox } from "./index";

/**
 * Example: How to use the Fermion Sandbox SDK
 *
 * This example demonstrates how to create and interact with a sandbox environment
 * for running code in isolated containers.
 */

async function main() {
  try {
    console.log("Creating sandbox with custom Git repository...");

    // Create a new sandbox instance
    // Snippet will be auto-created with a random name
    const sandbox = await Sandbox.create({
      gitRepoUrl: "https://github.com/gautamtayal1/solo",
    });

    console.log("Sandbox created successfully!");
    console.log("Session ID:", sandbox.getSessionId());
    console.log("Container Details:", sandbox.getContainerDetails());

    // Test command execution
    console.log("\n=== Testing Command Execution ===");

    // Test 1: runSmallCommand - Simple echo
    console.log("\n--- Test 1: runSmallCommand (echo) ---");
    const echoResult = await sandbox.runCommand({
      cmd: "echo",
      args: ["Hello from Fermion Sandbox!"],
    });
    console.log("Echo result:", {
      stdout: echoResult.stdout.trim(),
      stderr: echoResult.stderr,
    });

    // Test 2: runSmallCommand - Check current directory
    console.log("\n--- Test 2: runSmallCommand (pwd) ---");
    const pwdResult = await sandbox.runCommand({
      cmd: "pwd",
    });
    console.log("Current directory:", {
      stdout: pwdResult.stdout.trim(),
    });

    // Test 3: runSmallCommand - List files
    console.log("\n--- Test 3: runSmallCommand (ls) ---");
    const lsResult = await sandbox.runCommand({
      cmd: "ls",
      args: ["-la", "/home/damner/code"],
    });
    console.log("Files in /home/damner/code:", {
      lines: lsResult.stdout.split("\n").length,
    });

    // Test 4: runStreamingCommand - Echo with callbacks
    console.log("\n--- Test 4: runStreamingCommand (echo) ---");
    await sandbox.runStreamingCommand({
      cmd: "echo",
      args: ["Streaming output test!"],
      onStdout: (stdout) => {
        console.log("[Streaming stdout]:", stdout.trim());
      },
      onStderr: (stderr) => {
        console.log("[Streaming stderr]:", stderr);
      },
      onClose: (exitCode) => {
        console.log("[Streaming close] Exit code:", exitCode);
      },
    });

    // Test 5: runStreamingCommand - Long running command with multiple outputs
    console.log(
      "\n--- Test 5: runStreamingCommand (long running with streaming) ---",
    );
    await sandbox.runStreamingCommand({
      cmd: "sh",
      args: [
        "-c",
        'for i in 1 2 3 4 5; do echo "Progress: $i/5"; sleep 1; done; echo "Complete!"',
      ],
      onStdout: (stdout) => {
        process.stdout.write(stdout);
      },
      onStderr: (stderr) => {
        process.stderr.write(stderr);
      },
      onClose: (exitCode) => {
        console.log(`\n[Process exited with code: ${exitCode}]`);
      },
    });

    // Test 6: runStreamingCommand - Real-time command output (npm install simulation)
    console.log(
      "\n--- Test 6: runStreamingCommand (simulating package manager) ---",
    );
    await sandbox.runStreamingCommand({
      cmd: "sh",
      args: [
        "-c",
        `
				echo "Installing packages...";
				sleep 0.5;
				echo "✓ lodash@4.17.21";
				sleep 0.5;
				echo "✓ express@4.18.2";
				sleep 0.5;
				echo "✓ typescript@5.0.0";
				sleep 0.5;
				echo "";
				echo "Done! 3 packages installed."
			`,
      ],
      onStdout: (stdout) => {
        process.stdout.write(stdout);
      },
      onClose: (exitCode) => {
        console.log(`[Installation complete with exit code: ${exitCode}]`);
      },
    });

    await sandbox.runStreamingCommand({
      cmd: "npm",
      args: [
        "install",
        "lodash",
        "express",
        "typescript",
        "express-handlebars",
        "express-session",
        "express-validator",
        "express-flash",
        "express-helmet",
        "express-rate-limit",
        "express-sanitizer",
        "express-session",
        "express-validator",
        "express-flash",
        "express-helmet",
        "express-rate-limit",
        "express-sanitizer",
      ],
      onStdout: (stdout) => {
        process.stdout.write(stdout);
      },
    });

    // Test file operations
    console.log("\n=== Testing File Operations ===");

    // Write a file
    console.log("Writing file: /home/damner/code/hello.txt");
    await sandbox.setFile({
      path: "/home/damner/code/hello.txt",
      content: "Hello from Fermion Sandbox SDK!",
    });

    // Read the file back
    console.log("Reading file: /home/damner/code/hello.txt");
    const fileContent = await sandbox.getFile("/home/damner/code/hello.txt");
    console.log("File content:", fileContent);

    // Create a more complex example
    console.log("\nCreating a Node.js file...");
    await sandbox.setFile({
      path: "/home/damner/code/test.js",
      content: `console.log('Hello from Node.js!')
console.log('Current time:', new Date().toISOString())`,
    });

    // Run the Node.js file using runSmallCommand
    console.log("Running Node.js file...");
    const nodeResult = await sandbox.runCommand({
      cmd: "node",
      args: ["/home/damner/code/test.js"],
    });
    console.log("Node.js output:", {
      stdout: nodeResult.stdout,
    });

    // Keep the sandbox alive for testing
    console.log("\n✅ All tests completed successfully!");
    console.log("Keeping sandbox alive for 30 seconds...");
    console.log("Press Ctrl+C to exit early");

    // Keep alive for 30 seconds then exit cleanly
    await new Promise((resolve) => setTimeout(resolve, 30000));

    // Clean shutdown
    console.log("\nDisconnecting sandbox...");
    sandbox.disconnect();
    console.log("Done!");
    process.exit(0);
  } catch (error) {
    console.error("Error occurred:", error);
    process.exit(1);
  }
}

// Run the example
void main();
