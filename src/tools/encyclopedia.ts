// Tankopedia / encyclopedia tools

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeWargamingRequest } from "../api.js";
import { formatPrice } from "../format.js";
import { findTanksByName } from "../encyclopedia-cache.js";
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
                if (map.description) {
                    resultText += `   ${map.description}\n`;
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
            // The console API names module types vehicleGun, vehicleEngine,
            // etc. — the documented "gun"/"engine" values return INVALID_TYPE
            const API_MODULE_TYPES: Record<string, string> = {
                engine: "vehicleEngine",
                gun: "vehicleGun",
                radio: "vehicleRadio",
                suspension: "vehicleChassis",
                turret: "vehicleTurret",
            };
            const params: Record<string, string | number> = { limit };
            if (type) params.type = API_MODULE_TYPES[type];
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

            // The role tag is the data key (e.g. "commander") — entries
            // themselves only carry name + skills
            const response = await makeWargamingRequest<
                WargamingResponse<{
                    [key: string]: {
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

            crewRoles.forEach(([roleTag, roleData]) => {
                resultText += `**${roleData.name}** (${roleTag})\n`;

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
            // Console response has game_version, vehicle_nations,
            // vehicle_types, and achievement_sections — no tanks_updated_at
            // or vehicle_crew_roles like the PC API
            const response = await makeWargamingRequest<
                WargamingResponse<{
                    game_version: string;
                    vehicle_nations: Record<string, string | null>;
                    vehicle_types: Record<string, string>;
                    achievement_sections: Record<
                        string,
                        { name: string; order: number }
                    >;
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

            let resultText = `**Tankopedia Information**\n\n`;
            resultText += `**Game Version:** ${info.game_version}\n\n`;

            if (info.vehicle_nations) {
                const nations = Object.entries(info.vehicle_nations);
                resultText += `**Available Nations (${nations.length}):**\n`;
                nations.forEach(([nationKey, nationName]) => {
                    resultText += `• ${nationName || nationKey} (${nationKey})\n`;
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

            if (info.achievement_sections) {
                const sections = Object.entries(info.achievement_sections).sort(
                    ([, a], [, b]) => a.order - b.order
                );
                resultText += `**Achievement Sections (${sections.length}):**\n`;
                sections.forEach(([sectionKey, section]) => {
                    resultText += `• ${section.name} (${sectionKey})\n`;
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
    // The console API returns upgrades per vehicle — tank_id is required.
    server.tool(
        "get-vehicle-upgrades",
        "Get the equipment and consumables available for a specific vehicle. You can specify either tank_id OR tank_name.",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            tank_id: z
                .number()
                .optional()
                .describe(
                    "Vehicle ID to get upgrades for (use either tank_id OR tank_name)"
                ),
            tank_name: z
                .string()
                .optional()
                .describe(
                    "Vehicle name to search for (use either tank_id OR tank_name, e.g., 'IS-7')"
                ),
            type: z
                .enum(["equipment", "consumables"])
                .optional()
                .describe("Filter by upgrade type: equipment or consumables"),
            language: z
                .string()
                .optional()
                .default("en")
                .describe("Localization language (en, ru, pl, de, fr, es, tr)"),
        },
        async ({ platform, tank_id, tank_name, type, language = "en" }) => {
            if (!tank_id && !tank_name) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "❌ Error: You must specify either tank_id or tank_name — the Wargaming API returns upgrades per vehicle",
                        },
                    ],
                };
            }

            let actualTankId = tank_id;
            let tankLabelText = tank_id ? `Tank ID ${tank_id}` : tank_name!;

            if (tank_name && !tank_id) {
                const matches = await findTanksByName(platform, tank_name);
                if (matches.length === 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `❌ No tank found matching "${tank_name}" on ${platform.toUpperCase()}`,
                            },
                        ],
                    };
                }
                if (matches.length > 1) {
                    const tankList = matches
                        .slice(0, 5)
                        .map(
                            (v) => `• ${v.name} (ID: ${v.tank_id}, Tier ${v.tier})`
                        )
                        .join("\n");
                    return {
                        content: [
                            {
                                type: "text",
                                text: `❌ Multiple tanks found matching "${tank_name}". Please be more specific or use tank_id instead:\n\n${tankList}${
                                    matches.length > 5 ? "\n... and more" : ""
                                }`,
                            },
                        ],
                    };
                }
                actualTankId = matches[0].tank_id;
                tankLabelText = matches[0].name;
            }

            const params: Record<string, string | number> = {
                tank_id: actualTankId!,
                language,
            };
            if (type) params.type = type;

            interface UpgradeItem {
                name: string;
                description: string;
                price_credit: number;
                price_gold: number;
            }
            const response = await makeWargamingRequest<
                WargamingResponse<{
                    [key: string]: {
                        equipment?: Record<string, UpgradeItem>;
                        consumables?: Record<string, UpgradeItem>;
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

            const tankUpgrades = response.data?.[actualTankId!.toString()];
            if (!tankUpgrades) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No upgrade data found for ${tankLabelText}`,
                        },
                    ],
                };
            }

            // Descriptions embed color markup like $(col:aeff01)...$(col:end)
            const cleanText = (text: string) =>
                text.replace(/\$\(col:[^)]*\)/g, "").replace(/\n+/g, " — ");

            let resultText = `**Vehicle Upgrades for ${tankLabelText} (Tank ID: ${actualTankId})**\n\n`;

            const sections: Array<
                [string, Record<string, UpgradeItem> | undefined]
            > = [
                ["Equipment", tankUpgrades.equipment],
                ["Consumables", tankUpgrades.consumables],
            ];

            for (const [sectionName, items] of sections) {
                if (!items) continue;
                const entries = Object.values(items);
                resultText += `**${sectionName} (${entries.length}):**\n`;
                entries.forEach((upgrade) => {
                    resultText += `• **${upgrade.name}**`;
                    resultText += ` — Credits: ${formatPrice(
                        upgrade.price_credit
                    )}`;
                    if (upgrade.price_gold > 0) {
                        resultText += ` | Gold: ${formatPrice(
                            upgrade.price_gold
                        )}`;
                    }
                    resultText += `\n`;
                    if (
                        upgrade.description &&
                        upgrade.description !== upgrade.name
                    ) {
                        resultText += `  ${cleanText(upgrade.description)}\n`;
                    }
                });
                resultText += `\n`;
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
