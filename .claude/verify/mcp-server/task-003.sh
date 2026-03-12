#!/bin/bash
set -e
ROOT="/home/gabrewer/source/session-7"

for tool in get_mission_timeline get_targets; do
  grep -q "$tool" "$ROOT/mcp/src/index.ts" || { echo "FAIL: $tool not found in index.ts"; exit 1; }
done

cd "$ROOT"
bun test mcp/ --timeout 10000 2>&1 | grep -q "pass" || { echo "FAIL: MCP tool tests did not pass"; exit 1; }

echo "PASS: Additional tools verified"
