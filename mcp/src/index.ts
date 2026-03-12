import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Database } from "bun:sqlite";
import { join } from "path";

// Open the shared SQLite database relative to this package (mcp/../cassini.db)
const DB_PATH = join(import.meta.dir, "..", "..", "cassini.db");
const db = new Database(DB_PATH);

// Keep a reference so tools added later can use it
export { db };

// Initialise the MCP server
const server = new McpServer({
  name: "cassini-mcp",
  version: "0.1.0",
});

// Connect over stdio — this keeps the process alive waiting for JSON-RPC messages
const transport = new StdioServerTransport();

// Explicitly resume stdin so the event loop stays alive when stdin is a pipe
// (Bun may not keep the loop running on a data listener alone)
process.stdin.resume();

await server.connect(transport);
