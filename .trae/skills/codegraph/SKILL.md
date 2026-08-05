---
name: codegraph
description: CodeGraph is a codebase analysis tool that builds function-level dependency graphs. Use this skill when exploring unfamiliar codebases, understanding architecture, tracing dependencies, or analyzing code impact. It provides MCP tools for AI agents to query code structure efficiently.
license: MIT
---

# CodeGraph

## Overview

CodeGraph transforms your codebase into a semantically searchable knowledge graph that AI agents can reason about—not just grep through. It parses code with tree-sitter, builds dependency graphs, and exposes them via MCP tools for efficient codebase exploration.

## Core Capabilities

### 1. Project Initialization
```bash
# Build the graph (parse all files)
codegraph build

# Check graph health
codegraph stats
```

### 2. Dependency Analysis
```bash
# Analyze function impact
codegraph fn-impact <function-name>

# Trace dependencies
codegraph trace <file-path>

# Find callers
codegraph callers <function-name>
```

### 3. Architecture Exploration
```bash
# Show project structure
codegraph structure

# Find dead code
codegraph dead-code

# Check cycles
codegraph cycles
```

### 4. MCP Server Integration
CodeGraph runs an MCP server that provides these tools:
- `get_project_graph` - Get full codebase graph
- `search_symbols` - Search for symbols across files
- `trace_dependencies` - Trace upstream/downstream dependencies
- `get_function_context` - Get function details with callers/callees

## Usage Scenarios

**When to use this skill:**
- 📊 **Exploring new codebases**: Understand the architecture quickly
- 🔍 **Finding dependencies**: Trace what calls what
- ⚠️ **Impact analysis**: See what would break if you modify a function
- 🧹 **Code cleanup**: Find dead code and unused exports
- 🏗️ **Refactoring**: Plan changes with full context

## Quick Start

```bash
# 1. Initialize in project directory
cd your-project
codegraph init

# 2. Build the graph
codegraph build

# 3. Query the graph
codegraph structure

# 4. Start MCP server (for AI agents)
codegraph mcp serve
```

## Benefits

| Without CodeGraph | With CodeGraph |
|---|---|
| AI reads files one at a time | AI queries pre-built graph |
| High token usage | 50-70% token savings |
| Slow exploration | Instant answers |
| Misses structural context | Full dependency awareness |

## Resources

### scripts/
Helper scripts for common tasks:
- `analyze_project.py` - Project analysis automation
- `generate_report.py` - Generate architecture reports

### references/
- `api_reference.md` - MCP tool documentation
- `best_practices.md` - Usage guidelines

---

**Note**: CodeGraph runs locally with zero network calls. Your code stays on your machine.
