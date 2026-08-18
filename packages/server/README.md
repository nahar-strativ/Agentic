# earmark-server

Local broker that moves earmark annotations between the browser overlay and an AI agent.

```bash
npx earmark-server --port 7331
```

REST plus server-sent events plus long-poll, bound to loopback only.

```bash
npx earmark-server --store sqlite          # or json (default), memory
npx earmark-server --webhook https://…     # repeatable
npx earmark-server --token s3cret          # gate every request
```

Storage sits behind one adapter: `json` (readable, the default), `sqlite` (via
`node:sqlite`, so a real database for zero dependencies) and `memory`. Webhook
delivery is fire-and-forget with a timeout and one retry, and a hanging endpoint
can never stall the annotation loop.

Most people do not need this package directly: `earmark-mcp` runs the same broker
in the same process as the MCP server.

## Documentation

Full reference: https://nahar-strativ.github.io/Agentic/docs.html
Overview: https://nahar-strativ.github.io/Agentic/

Part of [earmark](https://github.com/nahar-strativ/Agentic). MIT licensed.
