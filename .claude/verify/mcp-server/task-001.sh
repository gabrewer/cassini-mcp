#!/bin/bash
set -e
ROOT="/home/gabrewer/source/session-7"

test -f "$ROOT/mcp/package.json" || { echo "FAIL: mcp/package.json not found"; exit 1; }
test -f "$ROOT/mcp/src/index.ts" || { echo "FAIL: mcp/src/index.ts not found"; exit 1; }

grep -q "modelcontextprotocol" "$ROOT/mcp/package.json" || { echo "FAIL: @modelcontextprotocol/sdk not in package.json"; exit 1; }
grep -q "StdioServerTransport" "$ROOT/mcp/src/index.ts" || { echo "FAIL: stdio transport not found in index.ts"; exit 1; }

echo "PASS: MCP server scaffolding verified"
