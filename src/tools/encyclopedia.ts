// Tankopedia / encyclopedia tools

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeWargamingRequest } from "../api.js";
import { formatPrice } from "../format.js";
import type { WargamingResponse } from "../types.js";

export function registerEncyclopediaTools(server: McpServer): void {
    // Tool: Get maps information
    server.tool(
        "get-maps",
        "Get information about World of Tanks Console battle maps",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
        },
        async ({ platform }) => {
            const response = await makeWargamingRequest<
                WargamingResponse<{ [key: string]: any }>
            >(platform, "/wotx/encyclopedia/arenas/", {});

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get maps information: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const maps = Object.values(response.data || {});
            if (maps.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "No maps data available",
                        },
                    ],
                };
            }

            let resultText = `**World of Tanks Console Maps (${maps.length} total)**\n\n`;

            maps.slice(0, 20).forEach((map: any, i) => {
                // Limit to first 20 maps
                resultText += `${i + 1}. **${map.name_i18n || map.arena_id}**\n`;
                if (map.description_i18n) {
                    resultText += `   ${map.description_i18n}\n`;
                }
            });

            if (maps.length > 20) {
                resultText += `\n*Showing first 20 of ${maps.length} maps*`;
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

    // Tool: Get encyclopedia achievements
    server.tool(
        "get-encyclopedia-achievements",
        "Get information about achievements, medals, and ribbons",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            category: z
                .enum(["achievements", "ribbons"])
                .optional()
                .describe("Filter by award category: achievements or ribbons"),
            language: z
                .string()
                .optional()
                .default("en")
                .describe("Localization language (en, ru, pl, de, fr, es, tr)"),
        },
        async ({ platform, category, language = "en" }) => {
            const params: Record<string, string> = { language };
            if (category) params.category = category;

            const response = await makeWargamingRequest<
                WargamingResponse<{
                    [key: string]: {
                        category: string;
                        condition: string;
                        description: string;
                        hero_info: string;
                        image: string;
                        name: string;
                        section: string;
                        type: string;
                        weight: number;
                    };
                }>
            >(platform, "/wotx/encyclopedia/achievements/", params);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get encyclopedia achievements: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const achievements = Object.entries(response.data || {});
            if (achievements.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No ${category || "achievements"} found`,
                        },
                    ],
                };
            }

            let resultText = `**Encyclopedia ${
                category
                    ? category.charAt(0).toUpperCase() + category.slice(1)
                    : "Achievements"
            } (${achievements.length} found)**\n\n`;

            // Group by section for better organization
            const achievementsBySection = achievements.reduce(
                (acc, [id, achievement]) => {
                    const section = achievement.section || "Other";
                    if (!acc[section]) acc[section] = [];
                    acc[section].push({ id, ...achievement });
                    return acc;
                },
                {} as Record<string, Array<any>>
            );

            Object.entries(achievementsBySection).forEach(
                ([section, sectionAchievements]) => {
                    resultText += `**${section}:**\n`;
                    sectionAchievements.slice(0, 10).forEach((achievement) => {
                        resultText += `• **${achievement.name}** (${achievement.id})\n`;
                        if (achievement.description) {
                            resultText += `  ${achievement.description}\n`;
                        }
                        if (achievement.condition) {
                            resultText += `  *Condition: ${achievement.condition}*\n`;
                        }
                        resultText += `\n`;
                    });
                    if (sectionAchievements.length > 10) {
                        resultText += `  ... and ${
                            sectionAchievements.length - 10
                        } more in this section\n\n`;
                    }
                }
            );

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

    // Tool: Get encyclopedia modules
    server.tool(
        "get-encyclopedia-modules",
        "Get information about available modules (engines, guns, radios, suspensions, turrets)",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            type: z
                .enum(["engine", "gun", "radio", "suspension", "turret"])
                .optional()
                .describe("Filter by module type"),
            nation: z.string().optional().describe("Filter by nation"),
            tier: z
                .number()
                .min(1)
                .max(10)
                .optional()
                .describe("Filter by tier (1-10)"),
            limit: z
                .number()
                .min(1)
                .max(100)
                .optional()
                .default(50)
                .describe("Maximum number of results"),
        },
        async ({ platform, type, nation, tier, limit = 50 }) => {
            const params: Record<string, string | number> = { limit };
            if (type) params.type = type;
            if (nation) params.nation = nation;
            if (tier) params.tier = tier;

            const response = await makeWargamingRequest<
                WargamingResponse<{
                    [key: string]: {
                        module_id: number;
                        name: string;
                        nation: string;
                        price_credit: number;
                        price_xp: number;
                        tier: number;
                        type: string;
                        weight: number;
                    };
                }>
            >(platform, "/wotx/encyclopedia/modules/", params);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get encyclopedia modules: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const modules = Object.entries(response.data || {});
            if (modules.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No modules found with the specified criteria`,
                        },
                    ],
                };
            }

            let resultText = `**Encyclopedia Modules (${modules.length} found)**\n\n`;

            // Group by type and tier
            const modulesByType = modules.reduce((acc, [id, module]) => {
                const typeKey = module.type || "Unknown";
                if (!acc[typeKey]) acc[typeKey] = [];
                acc[typeKey].push({ id, ...module });
                return acc;
            }, {} as Record<string, Array<any>>);

            Object.entries(modulesByType).forEach(
                ([moduleType, typeModules]) => {
                    resultText += `**${moduleType.toUpperCase()}:**\n`;

                    // Sort by tier and nation
                    const sortedModules = typeModules.sort((a, b) => {
                        if (a.tier !== b.tier) return a.tier - b.tier;
                        return a.nation.localeCompare(b.nation);
                    });

                    sortedModules.slice(0, 15).forEach((module) => {
                        resultText += `• **${module.name}** (Tier ${
                            module.tier
                        }, ${module.nation.toUpperCase()})\n`;
                        resultText += `  Credit Price: ${formatPrice(
                            module.price_credit
                        )}`;
                        if (module.price_xp > 0) {
                            resultText += ` | XP Price: ${formatPrice(
                                module.price_xp
                            )}`;
                        }
                        resultText += ` | Weight: ${module.weight}kg\n`;
                    });

                    if (typeModules.length > 15) {
                        resultText += `  ... and ${
                            typeModules.length - 15
                        } more ${moduleType}s\n`;
                    }
                    resultText += `\n`;
                }
            );

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

    // Tool: Get crew roles information
    server.tool(
        "get-crew-roles",
        "Get information about crew roles and their skills",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            role: z
                .string()
                .optional()
                .describe("Specific crew role to get info for"),
            language: z
                .string()
                .optional()
                .default("en")
                .describe("Localization language (en, ru, pl, de, fr, es, tr)"),
        },
        async ({ platform, role, language = "en" }) => {
            const params: Record<string, string> = { language };
            if (role) params.role = role;

            const response = await makeWargamingRequest<
                WargamingResponse<{
                    [key: string]: {
                        role: string;
                        name: string;
                        skills: Record<string, any>;
                    };
                }>
            >(platform, "/wotx/encyclopedia/crewroles/", params);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get crew roles: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const crewRoles = Object.entries(response.data || {});
            if (crewRoles.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: role
                                ? `No crew role found for "${role}"`
                                : "No crew roles found",
                        },
                    ],
                };
            }

            let resultText = `**Crew Roles Information**\n\n`;

            crewRoles.forEach(([, roleData]) => {
                resultText += `**${roleData.name}** (${roleData.role})\n`;

                const skills = Object.entries(roleData.skills || {});
                if (skills.length > 0) {
                    resultText += `**Available Skills (${skills.length}):**\n`;
                    skills
                        .slice(0, 10)
                        .forEach(([skillId, skillData]: [string, any]) => {
                            resultText += `• ${skillData.name || skillId}\n`;
                            if (skillData.description) {
                                resultText += `  ${skillData.description}\n`;
                            }
                        });
                    if (skills.length > 10) {
                        resultText += `• ... and ${
                            skills.length - 10
                        } more skills\n`;
                    }
                }
                resultText += `\n`;
            });

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

    // Tool: Get tankopedia info
    server.tool(
        "get-tankopedia-info",
        "Get general information about the Tankopedia including game version and available data",
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
                    game_version: string;
                    tanks_updated_at: number;
                    vehicle_crew_roles: Record<string, string>;
                    vehicle_nations: Record<string, string>;
                    vehicle_types: Record<string, string>;
                }>
            >(platform, "/wotx/encyclopedia/info/", { language });

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get tankopedia info: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const info = response.data;
            if (!info) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "No tankopedia information available",
                        },
                    ],
                };
            }

            const lastUpdate = new Date(
                info.tanks_updated_at * 1000
            ).toLocaleDateString();

            let resultText = `**Tankopedia Information**\n\n`;
            resultText += `**Game Version:** ${info.game_version}\n`;
            resultText += `**Last Updated:** ${lastUpdate}\n\n`;

            if (info.vehicle_nations) {
                const nations = Object.entries(info.vehicle_nations);
                resultText += `**Available Nations (${nations.length}):**\n`;
                nations.forEach(([nationKey, nationName]) => {
                    resultText += `• ${nationName} (${nationKey})\n`;
                });
                resultText += `\n`;
            }

            if (info.vehicle_types) {
                const types = Object.entries(info.vehicle_types);
                resultText += `**Vehicle Types (${types.length}):**\n`;
                types.forEach(([typeKey, typeName]) => {
                    resultText += `• ${typeName} (${typeKey})\n`;
                });
                resultText += `\n`;
            }

            if (info.vehicle_crew_roles) {
                const roles = Object.entries(info.vehicle_crew_roles);
                resultText += `**Crew Roles (${roles.length}):**\n`;
                roles.forEach(([roleKey, roleName]) => {
                    resultText += `• ${roleName} (${roleKey})\n`;
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

    // Tool: Get vehicle upgrades (equipment and consumables)
    server.tool(
        "get-vehicle-upgrades",
        "Get information about equipment and consumables",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            type: z
                .enum(["equipment", "consumable"])
                .optional()
                .describe("Filter by upgrade type: equipment or consumable"),
            language: z
                .string()
                .optional()
                .default("en")
                .describe("Localization language (en, ru, pl, de, fr, es, tr)"),
        },
        async ({ platform, type, language = "en" }) => {
            const params: Record<string, string> = { language };
            if (type) params.type = type;

            const response = await makeWargamingRequest<
                WargamingResponse<{
                    [key: string]: {
                        description: string;
                        image: string;
                        name: string;
                        price_credit: number;
                        price_gold: number;
                        type: string;
                        weight: number;
                    };
                }>
            >(platform, "/wotx/encyclopedia/vehicleupgrades/", params);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get vehicle upgrades: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const upgrades = Object.entries(response.data || {});
            if (upgrades.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No ${type || "upgrades"} found`,
                        },
                    ],
                };
            }

            let resultText = `**Vehicle ${
                type
                    ? type.charAt(0).toUpperCase() + type.slice(1) + "s"
                    : "Upgrades"
            } (${upgrades.length} found)**\n\n`;

            // Group by type
            const upgradesByType = upgrades.reduce((acc, [id, upgrade]) => {
                const upgradeType = upgrade.type || "Other";
                if (!acc[upgradeType]) acc[upgradeType] = [];
                acc[upgradeType].push({ id, ...upgrade });
                return acc;
            }, {} as Record<string, Array<any>>);

            Object.entries(upgradesByType).forEach(
                ([upgradeType, typeUpgrades]) => {
                    resultText += `**${upgradeType.toUpperCase()}:**\n`;

                    typeUpgrades.slice(0, 10).forEach((upgrade) => {
                        resultText += `• **${upgrade.name}**\n`;
                        if (upgrade.description) {
                            resultText += `  ${upgrade.description}\n`;
                        }
                        resultText += `  Credit Price: ${formatPrice(
                            upgrade.price_credit
                        )}`;
                        if (upgrade.price_gold > 0) {
                            resultText += ` | Gold Price: ${formatPrice(
                                upgrade.price_gold
                            )}`;
                        }
                        if (upgrade.weight > 0) {
                            resultText += ` | Weight: ${upgrade.weight}kg`;
                        }
                        resultText += `\n\n`;
                    });

                    if (typeUpgrades.length > 10) {
                        resultText += `... and ${
                            typeUpgrades.length - 10
                        } more ${upgradeType.toLowerCase()}s\n\n`;
                    }
                }
            );

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
