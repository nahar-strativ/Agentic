# earmark-mcp

MCP server that lets AI coding agents read, answer and resolve earmark UI annotations.

```bash
claude mcp add earmark -- npx -y earmark-mcp

# or write it into the project's .mcp.json
npx earmark-mcp init

# and when the agent cannot see your annotations
npx earmark-mcp doctor
```

Runs the annotation store, the HTTP endpoint the browser talks to, and the stdio
transport in a single process. There is no second daemon to keep alive.

Eleven tools: `earmark_list_annotations`, `earmark_watch_annotations`,
`earmark_get_annotation`, `earmark_list_sessions`, `earmark_get_session`,
`earmark_acknowledge`, `earmark_ask`, `earmark_resolve`, `earmark_dismiss`,
`earmark_clear`, `earmark_status`.

`doctor` checks the chain in the order it breaks (Node version, sqlite, MCP
registration, broker reachable, browser attached), prints the command that fixes
the first broken link, and exits non-zero so CI can use it.

## Documentation

Full reference: https://nahar-strativ.github.io/earmark/docs.html
Overview: https://nahar-strativ.github.io/earmark/

Part of [earmark](https://github.com/nahar-strativ/earmark). MIT licensed.
