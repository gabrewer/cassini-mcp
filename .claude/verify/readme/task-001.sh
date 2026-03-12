#!/bin/bash
set -e

README="/home/gabrewer/source/session-7/README.md"

test -f "$README" || { echo "FAIL: README.md not found"; exit 1; }

LINE_COUNT=$(wc -l < "$README")
if [ "$LINE_COUNT" -lt 50 ]; then
  echo "FAIL: README.md has only $LINE_COUNT lines (need >50)"
  exit 1
fi

echo "PASS: README.md exists with $LINE_COUNT lines"
