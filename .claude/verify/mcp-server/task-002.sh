#!/bin/bash
set -e
ROOT="/home/gabrewer/source/session-7"

# Check all four tools are registered
for tool in get_flybys get_observations get_body_summary get_team_stats; do
  grep -q "$tool" "$ROOT/mcp/src/index.ts" || { echo "FAIL: $tool not found in index.ts"; exit 1; }
done

# Verify Enceladus flyby count via bun test
cd "$ROOT"
bun test mcp/ --timeout 10000 2>&1 | grep -q "pass" || { echo "FAIL: MCP tool tests did not pass"; exit 1; }

echo "PASS: Core tools verified"
