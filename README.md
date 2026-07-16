# Wargaming MCP Server for World of Tanks Console

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives AI assistants (Claude Desktop, VS Code Copilot, or any MCP client) live access to the Wargaming API for **World of Tanks Console** (Xbox & PlayStation). Ask your assistant natural-language questions like *"How good is player X on Xbox?"* or *"Compare the IS-7 and the Maus"* and it answers with real data.

Built with **TypeScript**, the official **MCP SDK**, and **Zod** schema validation. Also includes a standalone Node.js CLI for quick API queries from the terminal.

## Features

- **30 MCP tools** covering players, clans, vehicles, progress tracking, and the full Tankopedia encyclopedia
- **Session & progress tracking** — the Wargaming API only exposes *lifetime* totals, so this server stores local stat snapshots and diffs them: `get-player-progress` answers "how did I do tonight?" with battles, win rate, average damage, and a per-tank breakdown *over the interval*. Snapshots also accumulate passively whenever you run `get-player-report`.
- **One-shot player reports** — `get-player-report` takes just a nickname and combines account search, overall stats, derived metrics (damage ratio, survival rate, frags/battle), top tanks, best performers, and clan membership into a single answer
- **Side-by-side tank comparison** — `compare-tanks "IS-7" "Maus"` produces a full armor/firepower/mobility table
- **Side-by-side player comparison** — `compare-players` puts two players' stats, most-played tanks, and best performers next to each other
- **Whole-clan reports** — `get-clan-report` fetches stats for every member in batched requests and aggregates them: battle-weighted win rate, activity buckets, top performers
- **Human-readable output everywhere** — tank IDs and achievement IDs are resolved to real names via a cached Tankopedia lookup
- **Smart tank search** — fuzzy name matching (`IS-7`, `IS 7`, and `IS7` all work)
- **Client-side rate limiting & retries** — requests are throttled to Wargaming's 10 req/s limit and automatically retried on transient errors
- **Response caching** — encyclopedia data is TTL-cached (1 h), so name lookups are effectively free after the first call
- **Actionable error messages** — common API errors (invalid key, IP restrictions, rate limits) come back with a hint on how to fix them
- **CI + smoke tests** — GitHub Actions builds the project and verifies the MCP protocol layer on every push

## Available Tools

### Reports (4) — start here

| Tool | Description |
| --- | --- |
| `get-player-report` | Complete player profile from a single nickname: stats, derived metrics, top tanks, best performers, clan |
| `compare-tanks` | Side-by-side comparison table of two tanks (by name or ID): armor, gun, ammo, mobility, view range |
| `compare-players` | Side-by-side comparison of two players: win rate, damage, survival, most-played and best tanks |
| `get-clan-report` | Aggregate report for an entire clan (by tag, name, or ID): battle-weighted averages, activity, top performers |

### Progress Tracking (3)

The Wargaming API only returns lifetime totals — these tools store local snapshots (one small JSON file per player) and diff them to reconstruct recent performance.

| Tool | Description |
| --- | --- |
| `snapshot-player` | Record a baseline snapshot of a player's current lifetime + per-tank stats |
| `get-player-progress` | Performance since a snapshot: battles, win rate, avg damage, per-tank breakdown over the interval; auto-saves a new snapshot |
| `list-player-snapshots` | List the stored snapshots for a player |

Snapshots live in `~/.wargaming-mcp-server/snapshots` (override with the `WARGAMING_MCP_DATA_DIR` env var) and are also recorded passively by `get-player-report`, so history accumulates from normal use.

### Player & Account (8)

| Tool | Description |
| --- | --- |
| `search-players` | Find players by nickname |
| `get-player-stats` | Overall combat statistics (battles, win rate, damage, XP) |
| `get-player-achievements` | Account-wide achievements with real medal names |
| `get-player-vehicles` | Per-tank stats summary for a player |
| `get-detailed-player-vehicle-stats` | Deep per-tank stats incl. survival rate, garage status, company battles |
| `get-player-vehicle-achievements` | Vehicle-specific achievements, ribbons, and series |
| `get-player-by-xuid` | Resolve a Microsoft XUID to an account |
| `get-player-by-psnid` | Resolve a PlayStation Network ID to an account |

### Clans (4)

| Tool | Description |
| --- | --- |
| `search-clans` | Find clans by name or tag |
| `get-clan-info` | Clan details (members, description, created date) |
| `get-player-clan-info` | A player's clan membership and role |
| `get-clan-glossary` | Clan role definitions |

### Vehicles & Tanks (5)

| Tool | Description |
| --- | --- |
| `get-vehicles` | Browse/filter vehicles by nation, type, tier, or name |
| `search-tanks-by-name` | Fuzzy tank search by name (exact-match optional) |
| `get-tank-details` | Tank specifications (HP, speed, weight, pricing) |
| `get-vehicle-characteristics` | Full configuration profile: armor, gun, ammo, engine, turret, radio, suspension — accepts a tank name *or* ID, with optional custom module IDs |
| `get-tank-modules` | Guns, engines, radios, suspensions, turrets by nation/tier |

### Encyclopedia (6)

| Tool | Description |
| --- | --- |
| `get-tankopedia-info` | Game version, nations, vehicle types, crew roles |
| `get-maps` | Battle maps with descriptions |
| `get-encyclopedia-achievements` | All achievements, medals, and ribbons |
| `get-encyclopedia-modules` | Detailed module database |
| `get-crew-roles` | Crew roles and their skills |
| `get-vehicle-upgrades` | Equipment and consumables |

## Quick Start

### Prerequisites

- **Node.js 18+**
- A free **Wargaming API key** from the [Wargaming Developer Portal](https://developers.wargaming.net/)
  > ⚠️ Choose a **Mobile** application type unless you have a static IP — **Server** keys are locked to an IP allowlist and will return `INVALID_IP_ADDRESS` from other addresses.

### Option A: Run via npx (no install)

Once published to npm, no clone or build is needed — point your MCP client at `npx`:

```json
{
    "mcpServers": {
        "wargaming": {
            "command": "npx",
            "args": ["-y", "wargaming-mcp-server"],
            "env": {
                "WARGAMING_API_KEY": "your_api_key_here"
            }
        }
    }
}
```

### Option B: Install from source

```bash
git clone https://github.com/lHyperionl/WG-Console-MCP-server.git
cd WG-Console-MCP-server
npm install

# add your API key
copy .env.example .env   # Windows (use `cp` on macOS/Linux)
# edit .env and set WARGAMING_API_KEY

npm run build
```

### Run the tests

```bash
npm test           # full suite: protocol checks + live API calls
SKIP_LIVE=1 npm test   # offline: protocol checks only (no API key traffic)
```

The smoke test builds the project, spawns the MCP server over stdio, verifies all 30 tools are registered, and exercises live calls against the Wargaming API — including the full `search → report`, `compare-tanks`, `compare-players`, `get-clan-report`, and `snapshot → progress` flows.

## Architecture

```text
src/
├── index.ts              # Entry point: registers tools, starts stdio transport
├── api.ts                # API client: rate limiting, retries, TTL cache, error hints
├── types.ts              # Shared Wargaming API response types
├── format.ts             # Number/percentage formatting helpers
├── encyclopedia-cache.ts # Cached tank & achievement name resolution
├── player-lookup.ts      # Shared nickname -> account resolution
├── snapshots.ts          # Local stat snapshot store for progress tracking
└── tools/
    ├── players.ts        # 8 player/account tools
    ├── clans.ts          # 4 clan tools
    ├── vehicles.ts       # 5 vehicle tools
    ├── encyclopedia.ts   # 6 tankopedia tools
    ├── reports.ts        # get-player-report, compare-tanks, compare-players, get-clan-report
    └── progress.ts       # snapshot-player, get-player-progress, list-player-snapshots
```

Cross-cutting concerns live in one place: every tool goes through `makeWargamingRequest`, which enforces the 10 req/s limit with a sliding-window throttle, retries transient failures (HTTP 5xx/429 and `REQUEST_LIMIT_EXCEEDED`) with backoff, caches encyclopedia responses for an hour, and annotates well-known API errors with fix-it hints.

## Claude Desktop Integration

Add to your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
    "mcpServers": {
        "wargaming": {
            "command": "node",
            "args": ["C:\\absolute\\path\\to\\wargaming-mcp-server\\build\\index.js"],
            "env": {
                "WARGAMING_API_KEY": "your_api_key_here"
            }
        }
    }
}
```

Restart Claude Desktop, then try:

- *"Give me a full report on player 'PlayerName' on Xbox"*
- *"Compare the IS-7 and the T110E5"*
- *"Compare me and my clanmate 'OtherPlayer'"*
- *"Take a snapshot of my stats"* — then, after a session: *"How did I do tonight?"*
- *"Give me a report on the clan with tag 'STEEL' — who are the top performers?"*
- *"Show me all tier 10 German heavy tanks"*
- *"Which of PlayerName's tanks has the best win rate?"*

VS Code users: the repo ships a ready-made [.vscode/mcp.json](.vscode/mcp.json) for the built-in MCP support.

## CLI Tool

For quick queries without an MCP client:

```bash
node wot-cli.js search-players "ProGamer"
node wot-cli.js player-stats 1088722148
node wot-cli.js player-vehicles 1088722148
node wot-cli.js search-vehicles 10 germany heavyTank
node wot-cli.js vehicle-characteristics "IS-7"
node wot-cli.js tank-modules guns germany 10
node wot-cli.js search-clans "STEEL"
node wot-cli.js maps
```

Run `node wot-cli.js` with no arguments for the full command reference.

## Continuous Integration

Every push runs the [CI workflow](.github/workflows/ci.yml): install → TypeScript build → smoke test. If a `WARGAMING_API_KEY` repository secret is configured, the live API checks run too; otherwise CI validates the MCP protocol layer offline.

## Troubleshooting

| Symptom | Cause / Fix |
| --- | --- |
| `INVALID_IP_ADDRESS` | Your key is a **Server**-type application restricted to specific IPs. Add your current IP in the [developer portal](https://developers.wargaming.net/applications/), or create a **Mobile**-type key. |
| `INVALID_APPLICATION_ID` | The API key in `.env` is wrong or was deactivated. |
| `REQUEST_LIMIT_EXCEEDED` | Wargaming rate limit (10 req/s) — the server throttles and retries automatically; if it persists, reduce parallel clients. |
| Server exits immediately | `WARGAMING_API_KEY` is not set — check your `.env` or MCP client `env` config. |

## Notes

- Xbox and PlayStation share a single unified API endpoint (`api-modernarmor.worldoftanks.com`); the `platform` parameter is kept for forward compatibility and labeling.
- This project is not affiliated with Wargaming. It is a community tool using the public Wargaming API.

## License

[ISC](LICENSE)
