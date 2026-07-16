#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { requireApiKey } from "./api.js";
import { registerPlayerTools } from "./tools/players.js";
import { registerClanTools } from "./tools/clans.js";
import { registerVehicleTools } from "./tools/vehicles.js";
import { registerEncyclopediaTools } from "./tools/encyclopedia.js";
import { registerReportTools } from "./tools/reports.js";
import { registerProgressTools } from "./tools/progress.js";

// Fail fast at startup if the API key is missing
requireApiKey();

const server = new McpServer({
    name: "wargaming-mcp-server",
    version: "2.2.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});

registerPlayerTools(server);
registerClanTools(server);
registerVehicleTools(server);
registerEncyclopediaTools(server);
registerReportTools(server);
registerProgressTools(server);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Wargaming MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
