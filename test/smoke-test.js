#!/usr/bin/env node

/**
 * Smoke test for the Wargaming MCP server.
 *
 * Spawns the built server (build/index.js) over stdio using the official
 * MCP client SDK, then verifies:
 *   1. The server initializes and lists all expected tools.
 *   2. Live tool calls against the Wargaming API return data.
 *
 * Requires WARGAMING_API_KEY in .env (see .env.example).
 * Set SKIP_LIVE=1 to skip the live API checks (used in CI when no
 * API key secret is configured).
 *
 * Run with: npm test
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
    StdioClientTransport,
    getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EXPECTED_TOOLS = [
    // Player & account
    "search-players",
    "get-player-stats",
    "get-player-achievements",
    "get-player-vehicles",
    "get-detailed-player-vehicle-stats",
    "get-player-vehicle-achievements",
    "get-player-by-xuid",
    "get-player-by-psnid",
    // Clans
    "search-clans",
    "get-clan-info",
    "get-player-clan-info",
    "get-clan-glossary",
    // Vehicles
    "get-vehicles",
    "get-tank-details",
    "get-tank-modules",
    "get-vehicle-characteristics",
    "search-tanks-by-name",
    // Encyclopedia
    "get-maps",
    "get-encyclopedia-achievements",
    "get-encyclopedia-modules",
    "get-crew-roles",
    "get-tankopedia-info",
    "get-vehicle-upgrades",
    // Reports
    "get-player-report",
    "compare-tanks",
    "compare-players",
    "get-clan-report",
    // Progress tracking
    "snapshot-player",
    "get-player-progress",
    "list-player-snapshots",
];

const SKIP_LIVE = process.env.SKIP_LIVE === "1";

let failures = 0;

function check(condition, label) {
    if (condition) {
        console.log(`  ✅ ${label}`);
    } else {
        console.error(`  ❌ ${label}`);
        failures++;
    }
}

async function callTool(client, name, args) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? "";
    return text;
}

async function main() {
    console.log("🧪 Wargaming MCP server smoke test\n");

    // Keep snapshot writes out of the real user data dir during tests.
    // The SDK filters the spawned server's environment to a safe allowlist,
    // so the API key must be passed through explicitly for CI (which sets
    // it as an env var instead of a .env file).
    const dataDir = mkdtempSync(path.join(tmpdir(), "wg-mcp-smoke-"));
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["build/index.js"],
        env: {
            ...getDefaultEnvironment(),
            ...(process.env.WARGAMING_API_KEY
                ? { WARGAMING_API_KEY: process.env.WARGAMING_API_KEY }
                : {}),
            WARGAMING_MCP_DATA_DIR: dataDir,
        },
    });
    const client = new Client({ name: "smoke-test", version: "1.0.0" });

    await client.connect(transport);
    console.log("Connected to server.\n");

    try {
        // 1. Tool listing
        console.log("Tool listing:");
        const { tools } = await client.listTools();
        const toolNames = tools.map((t) => t.name);
        check(
            tools.length === EXPECTED_TOOLS.length,
            `server exposes ${EXPECTED_TOOLS.length} tools (got ${tools.length})`
        );
        for (const name of EXPECTED_TOOLS) {
            if (!toolNames.includes(name)) {
                check(false, `missing tool: ${name}`);
            }
        }
        check(
            tools.every((t) => t.description && t.description.length > 0),
            "every tool has a description"
        );

        // 2. Live API calls
        if (SKIP_LIVE) {
            console.log(
                "\n⏭️  Skipping live API checks (SKIP_LIVE=1)"
            );
        } else {
            console.log("\nLive API calls:");

            const players = await callTool(client, "search-players", {
                platform: "xbox",
                search: "test",
                limit: 3,
            });
            check(
                /Found \d+ player\(s\)/.test(players),
                `search-players returns players (${players.split("\n")[0]})`
            );

            const tanks = await callTool(client, "search-tanks-by-name", {
                platform: "xbox",
                tank_name: "IS-7",
            });
            check(
                /Tank ID: \d+/.test(tanks),
                `search-tanks-by-name finds IS-7 (${tanks.split("\n")[0]})`
            );

            const tankIdMatch = tanks.match(/Tank ID: (\d+)/);
            if (tankIdMatch) {
                const characteristics = await callTool(
                    client,
                    "get-vehicle-characteristics",
                    { tank_id: Number(tankIdMatch[1]) }
                );
                check(
                    /HP: \d+/.test(characteristics),
                    "get-vehicle-characteristics returns HP/armor data"
                );
            }

            const comparison = await callTool(client, "compare-tanks", {
                tank_a: "IS-7",
                tank_b: "T110E5",
            });
            check(
                /\| HP \|/.test(comparison),
                "compare-tanks returns a side-by-side table"
            );

            const info = await callTool(client, "get-tankopedia-info", {
                platform: "xbox",
            });
            check(
                /Game Version/.test(info),
                "get-tankopedia-info returns game version"
            );

            // Chain search -> report to exercise get-player-report end-to-end
            const nicknames = [
                ...players.matchAll(/• (\S+) \(ID: \d+\)/g),
            ].map((m) => m[1]);
            if (nicknames.length > 0) {
                const report = await callTool(client, "get-player-report", {
                    platform: "xbox",
                    nickname: nicknames[0],
                });
                check(
                    /Player Report:/.test(report),
                    `get-player-report builds a report for ${nicknames[0]}`
                );

                // Progress tracking: snapshot, then diff against it
                const snapshot = await callTool(client, "snapshot-player", {
                    platform: "xbox",
                    nickname: nicknames[0],
                });
                check(
                    /Snapshot for/.test(snapshot),
                    "snapshot-player records a baseline"
                );
                const progress = await callTool(
                    client,
                    "get-player-progress",
                    { platform: "xbox", nickname: nicknames[0] }
                );
                check(
                    /Progress Report:|No battles played|recorded the first one/.test(
                        progress
                    ),
                    "get-player-progress diffs against the snapshot"
                );
                const snapshotList = await callTool(
                    client,
                    "list-player-snapshots",
                    { platform: "xbox", nickname: nicknames[0] }
                );
                check(
                    /Stored snapshots for/.test(snapshotList),
                    "list-player-snapshots lists the stored snapshot"
                );
            }
            if (nicknames.length > 1) {
                const playerComparison = await callTool(
                    client,
                    "compare-players",
                    {
                        platform: "xbox",
                        player_a: nicknames[0],
                        player_b: nicknames[1],
                    }
                );
                check(
                    /\| Battles \|/.test(playerComparison),
                    `compare-players compares ${nicknames[0]} vs ${nicknames[1]}`
                );
            }

            // Clan report: search -> aggregate report by clan ID
            const clans = await callTool(client, "search-clans", {
                platform: "xbox",
                search: "tank",
                limit: 3,
            });
            const clanIdMatch = clans.match(/ID: (\d+)/);
            if (clanIdMatch) {
                const clanReport = await callTool(client, "get-clan-report", {
                    platform: "xbox",
                    clan: clanIdMatch[1],
                });
                check(
                    /Clan Report:/.test(clanReport),
                    "get-clan-report aggregates member stats"
                );
            }
        }
    } finally {
        await client.close();
    }

    console.log(
        failures === 0
            ? "\n🎉 All smoke tests passed."
            : `\n💥 ${failures} check(s) failed.`
    );
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error("💥 Smoke test crashed:", error);
    process.exit(1);
});
