# Plan: README

## Overview

A setup guide for a side-by-side experiment: MCP server vs CLI tool for grounding an AI in a real-world domain dataset (the Cassini Saturn mission).

Target reader: a developer who's heard the hype about MCP servers and wants to know if they're actually better than a simple CLI for giving an AI domain knowledge. The README frames the experiment, explains the dataset, and gives them everything they need to run both approaches and compare — without telling them what to conclude.

## Tasks

### task-001: Write README.md

**Description:** Write the README.md at the project root. Must cover: the MCP vs CLI framing, what's in the repo (two implementations + shared dataset), what cassini.db contains and why it's a good test subject, setup instructions for both approaches (prerequisite list + commands), 3–5 example questions drawn from actual data (e.g. Enceladus flybys), and what to look for when comparing the two. Brief mention of agentloop as the build pipeline. No declared winner. Link out for MCP internals rather than explaining them.

**Acceptance Criteria:**
- README.md exists at project root
- Includes the MCP vs CLI experiment framing as the hook
- Explains the cassini.db dataset (master_plan and planets tables)
- Setup instructions for both implementations
- 3–5 example questions using actual data from the database
- "How to compare" section — what to look for, not what to conclude
- File has more than 50 lines
