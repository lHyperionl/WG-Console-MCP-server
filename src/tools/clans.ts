// Clan tools

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeWargamingRequest } from "../api.js";
import type { ClanInfo, WargamingResponse } from "../types.js";

export function registerClanTools(server: McpServer): void {
    // Tool: Search clans
    server.tool(
        "search-clans",
        "Search for World of Tanks Console clans",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            search: z.string().describe("Clan name or tag to search for"),
            limit: z
                .number()
                .min(1)
                .max(100)
                .default(10)
                .describe("Maximum number of results to return"),
        },
        async ({ platform, search, limit }) => {
            const response = await makeWargamingRequest<
                WargamingResponse<ClanInfo[]>
            >(platform, "/wotx/clans/list/", { search, limit });

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to search for clans: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const clans = response.data || [];
            if (clans.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No clans found with name/tag containing "${search}"`,
                        },
                    ],
                };
            }

            const clanList = clans
                .map((clan) => {
                    const createdDate = new Date(
                        clan.created_at * 1000
                    ).toLocaleDateString();
                    return `• **[${clan.tag}] ${clan.name}**\n  Members: ${clan.members_count} | Created: ${createdDate}\n  ID: ${clan.clan_id}`;
                })
                .join("\n\n");

            return {
                content: [
                    {
                        type: "text",
                        text: `Found ${
                            clans.length
                        } clan(s) on ${platform.toUpperCase()}:\n\n${clanList}`,
                    },
                ],
            };
        }
    );

    // Tool: Get clan details
    server.tool(
        "get-clan-info",
        "Get detailed information about a specific World of Tanks Console clan",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            clan_id: z.number().describe("Clan ID"),
        },
        async ({ platform, clan_id }) => {
            const response = await makeWargamingRequest<
                WargamingResponse<{ [key: string]: ClanInfo }>
            >(platform, "/wotx/clans/info/", { clan_id });

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get clan information: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const clanData = response.data[clan_id.toString()];
            if (!clanData) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No data found for clan ID ${clan_id}`,
                        },
                    ],
                };
            }

            const createdDate = new Date(
                clanData.created_at * 1000
            ).toLocaleDateString();

            const clanInfo = `
**Clan Information (ID: ${clan_id})**

**Basic Info:**
• Name: **[${clanData.tag}] ${clanData.name}**
• Members: ${clanData.members_count}
• Created: ${createdDate}

**Description:**
${clanData.description || "No description available"}
    `.trim();

            return {
                content: [
                    {
                        type: "text",
                        text: clanInfo,
                    },
                ],
            };
        }
    );

    // Tool: Get player clan membership info
    server.tool(
        "get-player-clan-info",
        "Get detailed clan membership information for a player",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            account_id: z.number().describe("Player's account ID"),
        },
        async ({ platform, account_id }) => {
            const response = await makeWargamingRequest<
                WargamingResponse<{
                    [key: string]: {
                        account_id: number;
                        clan_id: number;
                        joined_at: number;
                        role: string;
                        role_i18n: string;
                        clan: {
                            clan_id: number;
                            color: string;
                            created_at: number;
                            emblem_set_id: number;
                            members_count: number;
                            name: string;
                            tag: string;
                        };
                    };
                }>
            >(platform, "/wotx/clans/accountinfo/", { account_id });

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get player clan info: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const playerData = response.data[account_id.toString()];
            if (!playerData || !playerData.clan_id) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Player ID ${account_id} is not a member of any clan`,
                        },
                    ],
                };
            }

            const joinedDate = new Date(
                playerData.joined_at * 1000
            ).toLocaleDateString();
            const clanCreatedDate = new Date(
                playerData.clan.created_at * 1000
            ).toLocaleDateString();

            const clanInfo = `
**Player Clan Membership (ID: ${account_id})**

**Clan Information:**
• Name: **[${playerData.clan.tag}] ${playerData.clan.name}**
• Clan ID: ${playerData.clan.clan_id}
• Members: ${playerData.clan.members_count}
• Created: ${clanCreatedDate}

**Player's Role:**
• Role: ${playerData.role_i18n}
• Joined: ${joinedDate}
    `.trim();

            return {
                content: [
                    {
                        type: "text",
                        text: clanInfo,
                    },
                ],
            };
        }
    );

    // Tool: Get clan glossary/roles
    server.tool(
        "get-clan-glossary",
        "Get information about clan roles and entities",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            language: z
                .string()
                .optional()
                .default("en")
                .describe("Localization language (en, ru, pl, de, fr, es, tr)"),
        },
        async ({ platform, language = "en" }) => {
            const response = await makeWargamingRequest<
                WargamingResponse<{
                    clan_roles: {
                        [key: string]: {
                            role_id: string;
                            name: string;
                            name_i18n: string;
                        };
                    };
                }>
            >(platform, "/wotx/clans/glossary/", { language });

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get clan glossary: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const glossaryData = response.data;
            if (!glossaryData || !glossaryData.clan_roles) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "No clan glossary data available",
                        },
                    ],
                };
            }

            let resultText = `**Clan Roles and Entities**\n\n`;

            const roles = Object.entries(glossaryData.clan_roles);
            if (roles.length > 0) {
                resultText += `**Available Clan Roles:**\n`;
                roles.forEach(([, roleData]) => {
                    resultText += `• **${roleData.name_i18n}** (${roleData.role_id})\n`;
                });
            }

            return {
                content: [
                    {
                        type: "text",
                        text: resultText.trim(),
                    },
                ],
            };
        }
    );
}
