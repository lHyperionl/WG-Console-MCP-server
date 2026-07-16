// Player & account tools

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeWargamingRequest } from "../api.js";
import { formatNumber, percent } from "../format.js";
import {
    achievementLabel,
    getAchievementNames,
    getVehicleMap,
    tankLabel,
} from "../encyclopedia-cache.js";
import type {
    PlayerInfo,
    PlayerStats,
    PlayerVehicleStats,
    WargamingResponse,
} from "../types.js";

export function registerPlayerTools(server: McpServer): void {
    // Tool: Search for players
    server.tool(
        "search-players",
        "Search for World of Tanks Console players by nickname",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            search: z.string().describe("Player nickname to search for"),
            limit: z
                .number()
                .min(1)
                .max(100)
                .default(10)
                .describe("Maximum number of results to return"),
        },
        async ({ platform, search, limit }) => {
            const response = await makeWargamingRequest<
                WargamingResponse<PlayerInfo[]>
            >(platform, "/wotx/account/list/", { search, limit });

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to search for players: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const players = response.data || [];
            if (players.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No players found with nickname containing "${search}"`,
                        },
                    ],
                };
            }

            const playerList = players
                .map(
                    (player) =>
                        `• ${player.nickname} (ID: ${player.account_id})`
                )
                .join("\n");

            return {
                content: [
                    {
                        type: "text",
                        text: `Found ${
                            players.length
                        } player(s) on ${platform.toUpperCase()}:\n\n${playerList}`,
                    },
                ],
            };
        }
    );

    // Tool: Get player statistics
    server.tool(
        "get-player-stats",
        "Get detailed statistics for a World of Tanks Console player",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            account_id: z.number().describe("Player's account ID"),
        },
        async ({ platform, account_id }) => {
            const response = await makeWargamingRequest<
                WargamingResponse<{ [key: string]: PlayerStats }>
            >(platform, "/wotx/account/info/", { account_id });

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get player stats: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const playerData = response.data[account_id.toString()];
            if (!playerData) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No data found for player ID ${account_id}`,
                        },
                    ],
                };
            }

            const stats = playerData.statistics.all;
            const winRate = percent(stats.wins, stats.battles);

            const statsText = `
**Player Statistics (ID: ${account_id})**

**Overall Performance:**
• Battles: ${formatNumber(stats.battles)}
• Wins: ${formatNumber(stats.wins)} (${winRate}%)
• Losses: ${formatNumber(stats.losses)}
• Draws: ${formatNumber(stats.draws)}

**Combat Performance:**
• Average Damage: ${formatNumber(stats.avg_damage)}
• Total Damage Dealt: ${formatNumber(stats.damage_dealt)}
• Total Damage Received: ${formatNumber(stats.damage_received)}
• Frags (Kills): ${formatNumber(stats.frags)}
• Spots: ${formatNumber(stats.spots)}
• Average XP: ${formatNumber(stats.avg_xp)}
    `.trim();

            return {
                content: [
                    {
                        type: "text",
                        text: statsText,
                    },
                ],
            };
        }
    );

    // Tool: Get player achievements
    server.tool(
        "get-player-achievements",
        "Get player's achievements for World of Tanks Console",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            account_id: z.number().describe("Player's account ID"),
        },
        async ({ platform, account_id }) => {
            const [response, achievementNames] = await Promise.all([
                makeWargamingRequest<
                    WargamingResponse<{
                        [key: string]: {
                            achievements: Record<string, number>;
                        };
                    }>
                >(platform, "/wotx/account/achievements/", { account_id }),
                getAchievementNames(platform),
            ]);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get player achievements: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const playerData = response.data[account_id.toString()];
            if (!playerData) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No achievement data found for player ID ${account_id}`,
                        },
                    ],
                };
            }

            const achievements = playerData.achievements;
            const achievementCount = Object.keys(achievements).length;

            if (achievementCount === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Player ID ${account_id} has no achievements yet.`,
                        },
                    ],
                };
            }

            // Show the highest-count achievements first
            const achievementList = Object.entries(achievements)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 20)
                .map(
                    ([achievementId, count]) =>
                        `• ${achievementLabel(
                            achievementNames,
                            achievementId
                        )}: ${count}`
                )
                .join("\n");

            const achievementText = `
**Player Achievements (ID: ${account_id})**

**Total Achievements: ${achievementCount}**

**Top Achievements by Count:**
${achievementList}

${
    achievementCount > 20
        ? `\n*Showing first 20 of ${achievementCount} achievements*`
        : ""
}
    `.trim();

            return {
                content: [
                    {
                        type: "text",
                        text: achievementText,
                    },
                ],
            };
        }
    );

    // Tool: Get player vehicle statistics
    server.tool(
        "get-player-vehicles",
        "Get player's individual vehicle statistics for World of Tanks Console",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            account_id: z.number().describe("Player's account ID"),
            tank_id: z
                .number()
                .optional()
                .describe("Specific tank ID to get stats for"),
        },
        async ({ platform, account_id, tank_id }) => {
            const params: Record<string, string | number> = { account_id };
            if (tank_id) params.tank_id = tank_id;

            const [response, { vehicles }] = await Promise.all([
                makeWargamingRequest<
                    WargamingResponse<{ [key: string]: PlayerVehicleStats[] }>
                >(platform, "/wotx/account/tanks/", params),
                getVehicleMap(platform),
            ]);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get player vehicle stats: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const playerVehicles = response.data[account_id.toString()];
            if (!playerVehicles || playerVehicles.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No vehicle data found for player ID ${account_id}`,
                        },
                    ],
                };
            }

            let resultText = `**Player Vehicle Statistics (ID: ${account_id})**\n\n`;

            if (tank_id) {
                // Show detailed stats for specific tank
                const tankStats = playerVehicles.find(
                    (v) => v.tank_id === tank_id
                );
                if (tankStats) {
                    const stats = tankStats.statistics.all;
                    const winRate = percent(stats.wins, stats.battles);

                    resultText += `**${tankLabel(vehicles, tank_id)}**\n`;
                    resultText += `• Battles: ${formatNumber(stats.battles)}\n`;
                    resultText += `• Win Rate: ${winRate}%\n`;
                    resultText += `• Average Damage: ${formatNumber(
                        stats.avg_damage
                    )}\n`;
                    resultText += `• Max Damage: ${formatNumber(
                        stats.max_damage
                    )}\n`;
                    resultText += `• Frags: ${formatNumber(stats.frags)}\n`;
                    resultText += `• Max Frags: ${formatNumber(
                        stats.max_frags
                    )}\n`;
                    resultText += `• Mark of Mastery: ${stats.mark_of_mastery}\n`;
                } else {
                    resultText += `No statistics found for tank ID ${tank_id}`;
                }
            } else {
                // Show summary of all vehicles
                resultText += `**Total Vehicles: ${playerVehicles.length}**\n\n`;
                resultText += `**Top Vehicles by Battles:**\n`;

                const topVehicles = playerVehicles
                    .sort(
                        (a, b) =>
                            (b.statistics.all.battles || 0) -
                            (a.statistics.all.battles || 0)
                    )
                    .slice(0, 10);

                topVehicles.forEach((vehicle, i) => {
                    const stats = vehicle.statistics.all;
                    const winRate = percent(stats.wins, stats.battles, 1);
                    resultText += `${i + 1}. ${tankLabel(
                        vehicles,
                        vehicle.tank_id
                    )}: ${formatNumber(
                        stats.battles
                    )} battles, ${winRate}% WR\n`;
                });
            }

            return {
                content: [
                    {
                        type: "text",
                        text: resultText,
                    },
                ],
            };
        }
    );

    // Tool: Get detailed player vehicle statistics
    server.tool(
        "get-detailed-player-vehicle-stats",
        "Get comprehensive statistics for player's vehicles including garage status and detailed metrics",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            account_id: z.number().describe("Player's account ID"),
            tank_id: z
                .number()
                .optional()
                .describe("Specific tank ID to get stats for (optional)"),
            in_garage: z
                .enum(["0", "1"])
                .optional()
                .describe(
                    "Filter by garage status: 1 = in garage, 0 = not in garage"
                ),
        },
        async ({ platform, account_id, tank_id, in_garage }) => {
            const params: Record<string, string | number> = { account_id };
            if (tank_id) params.tank_id = tank_id;
            if (in_garage) params.in_garage = in_garage;

            const [response, { vehicles }] = await Promise.all([
                makeWargamingRequest<
                    WargamingResponse<{
                        [key: string]: Array<{
                            account_id: number;
                            tank_id: number;
                            mark_of_mastery: number;
                            in_garage: boolean;
                            all: {
                                battles: number;
                                wins: number;
                                losses: number;
                                damage_dealt: number;
                                damage_received: number;
                                frags: number;
                                spotted: number;
                                survived_battles: number;
                                xp: number;
                                max_damage: number;
                                max_frags: number;
                                max_xp: number;
                            };
                            company: {
                                battles: number;
                                wins: number;
                                damage_dealt: number;
                                frags: number;
                            };
                        }>;
                    }>
                >(platform, "/wotx/tanks/stats/", params),
                getVehicleMap(platform),
            ]);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get detailed vehicle stats: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const vehicleData = response.data[account_id.toString()];
            if (!vehicleData || vehicleData.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No vehicle statistics found for player ID ${account_id}`,
                        },
                    ],
                };
            }

            let resultText = `**Detailed Vehicle Statistics (Player ID: ${account_id})**\n\n`;

            if (tank_id) {
                // Show detailed stats for specific tank
                const tankStats = vehicleData.find(
                    (v) => v.tank_id === tank_id
                );
                if (tankStats) {
                    const stats = tankStats.all;
                    const winRate = percent(stats.wins, stats.battles);
                    const survivalRate = percent(
                        stats.survived_battles,
                        stats.battles
                    );
                    const avgDamage =
                        stats.battles > 0
                            ? (stats.damage_dealt / stats.battles).toFixed(0)
                            : "0";

                    resultText += `**${tankLabel(vehicles, tank_id)}** ${
                        tankStats.in_garage ? "(In Garage)" : "(Not in Garage)"
                    }\n\n`;
                    resultText += `**Performance Metrics:**\n`;
                    resultText += `• Battles: ${stats.battles.toLocaleString()}\n`;
                    resultText += `• Win Rate: ${winRate}%\n`;
                    resultText += `• Survival Rate: ${survivalRate}%\n`;
                    resultText += `• Average Damage: ${avgDamage}\n`;
                    resultText += `• Max Damage: ${stats.max_damage.toLocaleString()}\n`;
                    resultText += `• Total Frags: ${stats.frags.toLocaleString()}\n`;
                    resultText += `• Max Frags: ${stats.max_frags}\n`;
                    resultText += `• Mark of Mastery: ${tankStats.mark_of_mastery}\n`;
                    resultText += `• Total XP: ${stats.xp.toLocaleString()}\n`;
                    resultText += `• Max XP: ${stats.max_xp}\n`;

                    if (tankStats.company.battles > 0) {
                        const companyWinRate = percent(
                            tankStats.company.wins,
                            tankStats.company.battles
                        );
                        resultText += `\n**Company Battles:**\n`;
                        resultText += `• Battles: ${tankStats.company.battles}\n`;
                        resultText += `• Win Rate: ${companyWinRate}%\n`;
                        resultText += `• Damage: ${tankStats.company.damage_dealt.toLocaleString()}\n`;
                    }
                } else {
                    resultText += `No statistics found for tank ID ${tank_id}`;
                }
            } else {
                // Show summary of all vehicles
                const totalVehicles = vehicleData.length;
                const inGarageCount = vehicleData.filter(
                    (v) => v.in_garage
                ).length;

                resultText += `**Vehicle Summary:**\n`;
                resultText += `• Total Vehicles: ${totalVehicles}\n`;
                resultText += `• In Garage: ${inGarageCount}\n`;
                resultText += `• Not in Garage: ${
                    totalVehicles - inGarageCount
                }\n\n`;

                // Top vehicles by battles
                const topVehicles = vehicleData
                    .sort((a, b) => b.all.battles - a.all.battles)
                    .slice(0, 10);

                resultText += `**Top 10 Vehicles by Battles:**\n`;
                topVehicles.forEach((vehicle, i) => {
                    const stats = vehicle.all;
                    const winRate = percent(stats.wins, stats.battles, 1);
                    const garageStatus = vehicle.in_garage ? "🏠" : "❌";
                    resultText += `${i + 1}. ${tankLabel(
                        vehicles,
                        vehicle.tank_id
                    )} ${garageStatus}: ${stats.battles.toLocaleString()} battles, ${winRate}% WR, MoE: ${
                        vehicle.mark_of_mastery
                    }\n`;
                });
            }

            return {
                content: [
                    {
                        type: "text",
                        text: resultText,
                    },
                ],
            };
        }
    );

    // Tool: Get player vehicle achievements
    server.tool(
        "get-player-vehicle-achievements",
        "Get vehicle-specific achievements for a player",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            account_id: z.number().describe("Player's account ID"),
            tank_id: z
                .number()
                .optional()
                .describe(
                    "Specific tank ID to get achievements for (optional)"
                ),
            in_garage: z
                .enum(["0", "1"])
                .optional()
                .describe(
                    "Filter by garage status: 1 = in garage, 0 = not in garage"
                ),
        },
        async ({ platform, account_id, tank_id, in_garage }) => {
            const params: Record<string, string | number> = { account_id };
            if (tank_id) params.tank_id = tank_id;
            if (in_garage) params.in_garage = in_garage;

            const [response, { vehicles }, achievementNames] =
                await Promise.all([
                    makeWargamingRequest<
                        WargamingResponse<{
                            [key: string]: Array<{
                                account_id: number;
                                tank_id: number;
                                achievements: Record<string, number>;
                                max_series: Record<string, number>;
                                ribbons: Record<string, number>;
                                series: Record<string, number>;
                            }>;
                        }>
                    >(platform, "/wotx/tanks/achievements/", params),
                    getVehicleMap(platform),
                    getAchievementNames(platform),
                ]);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get vehicle achievements: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const achievementData = response.data[account_id.toString()];
            if (!achievementData || achievementData.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No vehicle achievements found for player ID ${account_id}`,
                        },
                    ],
                };
            }

            let resultText = `**Vehicle Achievements (Player ID: ${account_id})**\n\n`;

            if (tank_id) {
                // Show achievements for specific tank
                const tankAchievements = achievementData.find(
                    (v) => v.tank_id === tank_id
                );
                if (tankAchievements) {
                    resultText += `**${tankLabel(
                        vehicles,
                        tank_id
                    )} Achievements**\n\n`;

                    const achievements = Object.entries(
                        tankAchievements.achievements
                    );
                    const ribbons = Object.entries(tankAchievements.ribbons);
                    const maxSeries = Object.entries(
                        tankAchievements.max_series
                    );

                    if (achievements.length > 0) {
                        resultText += `**Achievements (${achievements.length}):**\n`;
                        achievements.slice(0, 15).forEach(([achId, count]) => {
                            resultText += `• ${achievementLabel(
                                achievementNames,
                                achId
                            )}: ${count}\n`;
                        });
                        if (achievements.length > 15) {
                            resultText += `• ... and ${
                                achievements.length - 15
                            } more\n`;
                        }
                        resultText += `\n`;
                    }

                    if (ribbons.length > 0) {
                        resultText += `**Ribbons (${ribbons.length}):**\n`;
                        ribbons.slice(0, 10).forEach(([ribbonId, count]) => {
                            resultText += `• ${achievementLabel(
                                achievementNames,
                                ribbonId
                            )}: ${count}\n`;
                        });
                        if (ribbons.length > 10) {
                            resultText += `• ... and ${
                                ribbons.length - 10
                            } more\n`;
                        }
                        resultText += `\n`;
                    }

                    if (maxSeries.length > 0) {
                        resultText += `**Achievement Series:**\n`;
                        maxSeries.forEach(([seriesId, maxValue]) => {
                            resultText += `• ${achievementLabel(
                                achievementNames,
                                seriesId
                            )}: ${maxValue}\n`;
                        });
                    }
                } else {
                    resultText += `No achievements found for tank ID ${tank_id}`;
                }
            } else {
                // Show summary across all vehicles
                let totalAchievements = 0;
                let totalRibbons = 0;
                const vehicleCount = achievementData.length;

                achievementData.forEach((vehicle) => {
                    totalAchievements += Object.keys(
                        vehicle.achievements
                    ).length;
                    totalRibbons += Object.keys(vehicle.ribbons).length;
                });

                resultText += `**Achievement Summary Across ${vehicleCount} Vehicles:**\n`;
                resultText += `• Total Achievement Types: ${totalAchievements}\n`;
                resultText += `• Total Ribbon Types: ${totalRibbons}\n\n`;

                // Show vehicles with most achievements
                const topAchievementVehicles = achievementData
                    .map((vehicle) => ({
                        tank_id: vehicle.tank_id,
                        achievementCount: Object.keys(vehicle.achievements)
                            .length,
                        ribbonCount: Object.keys(vehicle.ribbons).length,
                    }))
                    .sort((a, b) => b.achievementCount - a.achievementCount)
                    .slice(0, 10);

                resultText += `**Top 10 Vehicles by Achievement Count:**\n`;
                topAchievementVehicles.forEach((vehicle, i) => {
                    resultText += `${i + 1}. ${tankLabel(
                        vehicles,
                        vehicle.tank_id
                    )}: ${vehicle.achievementCount} achievements, ${
                        vehicle.ribbonCount
                    } ribbons\n`;
                });
            }

            return {
                content: [
                    {
                        type: "text",
                        text: resultText,
                    },
                ],
            };
        }
    );

    // Tool: Get player by Xbox XUID
    server.tool(
        "get-player-by-xuid",
        "Get player account information using Xbox XUID",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            xuid: z.number().describe("Player Microsoft XUID"),
        },
        async ({ platform, xuid }) => {
            const response = await makeWargamingRequest<
                WargamingResponse<{
                    [key: string]: { account_id: number; xuid: number };
                }>
            >(platform, "/wotx/account/xuidinfo/", { xuid });

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get player by XUID: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const xuids = Object.entries(response.data || {});
            if (xuids.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No player found with XUID ${xuid}`,
                        },
                    ],
                };
            }

            const playerData = xuids[0][1];
            return {
                content: [
                    {
                        type: "text",
                        text: `**Player Found by XUID ${xuid}:**\n• Account ID: ${playerData.account_id}\n• XUID: ${playerData.xuid}`,
                    },
                ],
            };
        }
    );

    // Tool: Get player by PlayStation ID
    server.tool(
        "get-player-by-psnid",
        "Get player account information using PlayStation Network ID",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            psnid: z.string().describe("PlayStation Network ID"),
        },
        async ({ platform, psnid }) => {
            const response = await makeWargamingRequest<
                WargamingResponse<{
                    [key: string]: { account_id: number; psnid: string };
                }>
            >(platform, "/wotx/account/psninfo/", { psnid });

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get player by PSN ID: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const psnids = Object.entries(response.data || {});
            if (psnids.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No player found with PSN ID ${psnid}`,
                        },
                    ],
                };
            }

            const playerData = psnids[0][1];
            return {
                content: [
                    {
                        type: "text",
                        text: `**Player Found by PSN ID ${psnid}:**\n• Account ID: ${playerData.account_id}\n• PSN ID: ${playerData.psnid}`,
                    },
                ],
            };
        }
    );
}
