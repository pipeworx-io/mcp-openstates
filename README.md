# @pipeworx/openstates

OpenStates v3 MCP — bills, legislators, votes in all 50 US states.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

- `search_bills(jurisdiction, query?, session?, classification?, sponsor?, sort?, per_page?, page?)`
- `get_bill(openstates_id?, jurisdiction?, session?, identifier?)`
- `search_legislators(jurisdiction?, name?, org_classification?, district?, party?, per_page?, page?)`
- `get_legislator(person_id)`

## Auth

- **Platform key:** gateway env `PLATFORM_OPENSTATES_KEY`.
- **BYO:** `?_apiKey=<key>` after registering at https://openstates.org/account/profile/ (free ~5,000 req/day).

## Data source

`https://v3.openstates.org` — header `X-API-KEY`.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "openstates": {
      "url": "https://gateway.pipeworx.io/openstates/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Openstates data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
