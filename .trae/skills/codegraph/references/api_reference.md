# CodeGraph MCP API Reference

## Overview

CodeGraph provides an MCP (Model Context Protocol) server that AI agents can use to query codebase structure efficiently.

## Starting the MCP Server

```bash
codegraph mcp serve
```

Default port: 8080

## Available Tools

### 1. get_project_graph

**Description**: Returns the full project graph structure
**Replaces**: Manual file reading and grep

**Parameters**:
- `include_symbols` (bool): Include symbol information (default: true)
- `include_edges` (bool): Include dependency edges (default: true)

**Response**:
```json
{
  "files": [...],
  "symbols": [...],
  "edges": [...],
  "summary": {
    "file_count": 42,
    "function_count": 156,
    "dependency_count": 342
  }
}
```

### 2. search_symbols

**Description**: Search for symbols across the codebase
**Replaces**: Grep searches

**Parameters**:
- `query` (string): Search term
- `type` (string): Optional filter (function, class, variable, etc.)
- `limit` (int): Maximum results (default: 20)

**Response**:
```json
{
  "results": [
    {
      "name": "authenticate_user",
      "type": "function",
      "file": "src/auth/service.py",
      "line": 42
    }
  ]
}
```

### 3. trace_dependencies

**Description**: Trace upstream/downstream dependencies for a file or function
**Replaces**: Manual EDGES parsing

**Parameters**:
- `target` (string): File path or function name
- `direction` (string): "upstream", "downstream", or "both" (default: "both")
- `depth` (int): Maximum recursion depth (default: 3)

**Response**:
```json
{
  "target": "src/auth/service.py",
  "upstream": [...],
  "downstream": [...],
  "impacted_files": ["src/api/routes.py", "src/utils/validators.py"]
}
```

### 4. get_function_context

**Description**: Get detailed context for a specific function
**Replaces**: Reading individual files

**Parameters**:
- `name` (string): Function name
- `file` (string): Optional file path to disambiguate

**Response**:
```json
{
  "name": "process_order",
  "file": "src/orders/service.py",
  "line": 128,
  "callers": ["create_order", "update_order"],
  "callees": ["validate_order", "save_to_db", "send_notification"],
  "parameters": [...],
  "return_type": "Order",
  "docstring": "..."
}
```

### 5. analyze_impact

**Description**: Analyze the impact of modifying a function
**Replaces**: Manual codebase exploration

**Parameters**:
- `function_name` (string): Name of function to analyze
- `file_path` (string): Optional file path

**Response**:
```json
{
  "function": "parse_config",
  "impacted_files": 9,
  "impacted_functions": 14,
  "critical_paths": [...],
  "suggestions": ["Update tests in test_config.py", "Check API docs"]
}
```

## Error Types

| Error Type | Description | Suggested Action |
|---|---|---|
| `GRAPH_NOT_FOUND` | Project not initialized | Run `codegraph init && codegraph build` |
| `FILE_NOT_IN_GRAPH` | File not indexed | Rebuild graph with `codegraph build` |
| `INVALID_PATH` | Invalid file path | Check path and try again |
| `TOOL_TIMEOUT` | Request timed out | Retry with smaller scope |
| `UNKNOWN_TOOL` | Invalid tool name | Check tool name spelling |

## Usage Best Practices

1. **Always initialize first**: Run `codegraph init && codegraph build` before using MCP tools

2. **Prefer graph queries over file reads**: Use `get_project_graph` instead of reading multiple files

3. **Use search_symbols instead of grep**: Faster and more precise results

4. **Check impact before modifying**: Use `analyze_impact` to understand blast radius

5. **Start the server once**: Keep `codegraph mcp serve` running during development sessions

## Environment Variables

- `CODEGRAPH_MCP_PORT`: Set custom MCP port (default: 8080)
- `CODEGRAPH_LOG_LEVEL`: Log level (debug, info, warn, error)
