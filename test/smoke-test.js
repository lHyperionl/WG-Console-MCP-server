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
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["build/index.js"],
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
            const nicknameMatch = players.match(/• (\S+) \(ID: \d+\)/);
            if (nicknameMatch) {
                const report = await callTool(client, "get-player-report", {
                    platform: "xbox",
                    nickname: nicknameMatch[1],
                });
                check(
                    /Player Report:/.test(report),
                    `get-player-report builds a report for ${nicknameMatch[1]}`
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
