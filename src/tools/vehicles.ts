// Vehicle & tank tools

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeWargamingRequest } from "../api.js";
import { formatNumber, formatPrice } from "../format.js";
import {
    findTanksByName,
    getVehicleMap,
    matchesVehicleName,
} from "../encyclopedia-cache.js";
import type {
    TankDetails,
    VehicleInfo,
    VehicleModule,
    VehicleProfile,
    WargamingResponse,
} from "../types.js";

export function registerVehicleTools(server: McpServer): void {
    // Tool: Get vehicle information
    server.tool(
        "get-vehicles",
        "Get information about World of Tanks Console vehicles/tanks",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            nation: z
                .string()
                .optional()
                .describe("Filter by nation (e.g., usa, germany, ussr)"),
            type: z
                .string()
                .optional()
                .describe(
                    "Filter by vehicle type (e.g., heavyTank, mediumTank, lightTank, AT-SPG, SPG)"
                ),
            tier: z
                .number()
                .min(1)
                .max(10)
                .optional()
                .describe("Filter by tier (1-10)"),
            name: z
                .string()
                .optional()
                .describe(
                    "Search for vehicles containing this name (e.g., 'IS-7', 'Tiger', 'Sherman')"
                ),
        },
        async ({ platform, nation, type, tier, name }) => {
            // nation and tier are filtered server-side; the console API
            // silently ignores a `type` param, so type is filtered locally
            const params: Record<string, string | number> = {};
            if (nation) params.nation = nation;
            if (tier) params.tier = tier;

            const response = await makeWargamingRequest<
                WargamingResponse<{ [key: string]: VehicleInfo }>
            >(platform, "/wotx/encyclopedia/vehicles/", params);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get vehicle information: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            let vehicles = Object.entries(response.data || {}).map(
                ([tank_id, vehicle]) => ({
                    ...vehicle,
                    tank_id: parseInt(tank_id),
                })
            );

            // Filter by type client-side (see note above)
            if (type) {
                const wanted = type.toLowerCase();
                vehicles = vehicles.filter(
                    (vehicle) => vehicle.type?.toLowerCase() === wanted
                );
            }

            // Filter by name if provided
            if (name) {
                vehicles = vehicles.filter((vehicle) =>
                    matchesVehicleName(vehicle, name)
                );
            }

            if (vehicles.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: name
                                ? `No vehicles found matching "${name}" with the specified criteria`
                                : "No vehicles found with the specified criteria",
                        },
                    ],
                };
            }

            // Group vehicles by tier for better organization
            const vehiclesByTier = vehicles.reduce((acc, vehicle) => {
                const tierKey = `Tier ${vehicle.tier}`;
                if (!acc[tierKey]) acc[tierKey] = [];
                acc[tierKey].push(vehicle);
                return acc;
            }, {} as Record<string, VehicleInfo[]>);

            let resultText = `Found ${
                vehicles.length
            } vehicle(s) on ${platform.toUpperCase()}`;

            if (name) {
                resultText += ` matching "${name}"`;
            }
            resultText += `:\n\n`;

            Object.entries(vehiclesByTier).forEach(
                ([tierName, tierVehicles]) => {
                    resultText += `**${tierName}:**\n`;
                    tierVehicles.forEach((vehicle) => {
                        resultText += `• **${vehicle.name}** (Tank ID: ${vehicle.tank_id})\n`;
                        resultText += `  Nation: ${vehicle.nation.toUpperCase()}, Type: ${
                            vehicle.type
                        }\n`;
                        if (vehicle.short_name) {
                            resultText += `  Short Name: ${vehicle.short_name}\n`;
                        }
                        resultText += `\n`;
                    });
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

    // Tool: Get tank details and specifications
    server.tool(
        "get-tank-details",
        "Get detailed specifications for World of Tanks Console vehicles",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            tank_id: z.number().describe("Tank ID to get details for"),
        },
        async ({ platform, tank_id }) => {
            const response = await makeWargamingRequest<
                WargamingResponse<{ [key: string]: TankDetails }>
            >(platform, "/wotx/encyclopedia/vehicles/", { tank_id });

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get tank details: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const tankData = response.data[tank_id.toString()];
            if (!tankData) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No data found for tank ID ${tank_id}`,
                        },
                    ],
                };
            }

            const tankDetails = `
**Tank Details (ID: ${tank_id})**

**Basic Information:**
• Name: **${tankData.name}**
• Nation: ${tankData.nation.toUpperCase()}
• Type: ${tankData.type}
• Tier: ${tankData.tier}

**Combat Specifications:**
• Max Health: ${formatNumber(tankData.max_health)} HP
• Max Speed: ${formatNumber(tankData.speed_limit)} km/h
• Weight: ${formatNumber(tankData.weight)} kg
• Max Ammo: ${formatNumber(tankData.max_ammo)}
• Fire Chance: ${
                tankData.fire_chance
                    ? (tankData.fire_chance * 100).toFixed(1)
                    : "N/A"
            }%

**Economics:**
• Credit Price: ${formatNumber(tankData.price_credit)}
• Gold Price: ${formatNumber(tankData.price_gold)}

**Description:**
${tankData.description || "No description available"}
    `.trim();

            return {
                content: [
                    {
                        type: "text",
                        text: tankDetails,
                    },
                ],
            };
        }
    );

    // The console API has no standalone /encyclopedia/guns|engines|.../
    // methods (those are PC-only) — everything lives under /modules/ with
    // its own type naming.
    const MODULE_TYPE_MAP = {
        guns: "vehicleGun",
        engines: "vehicleEngine",
        radios: "vehicleRadio",
        suspensions: "vehicleChassis",
        turrets: "vehicleTurret",
    } as const;

    // Tool: Get tank modules (guns, engines, etc.)
    server.tool(
        "get-tank-modules",
        "Get available modules (guns, engines, turrets) for World of Tanks Console vehicles",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            module_type: z
                .enum(["guns", "engines", "radios", "suspensions", "turrets"])
                .describe("Type of module to search for"),
            nation: z
                .string()
                .optional()
                .describe("Filter by nation (e.g., usa, germany, ussr)"),
            tier: z
                .number()
                .min(1)
                .max(10)
                .optional()
                .describe("Filter by tier (1-10)"),
        },
        async ({ platform, module_type, nation, tier }) => {
            const params: Record<string, string | number> = {
                type: MODULE_TYPE_MAP[module_type],
            };
            if (nation) params.nation = nation;
            if (tier) params.tier = tier;

            const response = await makeWargamingRequest<
                WargamingResponse<{ [key: string]: VehicleModule }>
            >(platform, "/wotx/encyclopedia/modules/", params);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get ${module_type}: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const modules = Object.values(response.data || {});
            if (modules.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No ${module_type} found with the specified criteria`,
                        },
                    ],
                };
            }

            let resultText = `**${module_type.toUpperCase()} (${
                modules.length
            } found)**\n\n`;

            // Group by tier for better organization
            const modulesByTier = modules.reduce((acc, module) => {
                const tierKey = `Tier ${module.tier}`;
                if (!acc[tierKey]) acc[tierKey] = [];
                acc[tierKey].push(module);
                return acc;
            }, {} as Record<string, VehicleModule[]>);

            Object.entries(modulesByTier).forEach(
                ([tierName, tierModules]) => {
                    resultText += `**${tierName}:**\n`;
                    tierModules.slice(0, 10).forEach((module) => {
                        // Limit to 10 per tier
                        resultText += `• ${
                            module.name
                        } (${module.nation.toUpperCase()}, ID: ${
                            module.module_id
                        })\n`;
                        resultText += `  Credit Price: ${formatNumber(
                            module.price_credit
                        )} | Weight: ${formatNumber(module.weight)}kg\n`;
                    });
                    resultText += "\n";
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

    // Tool: Get vehicle characteristics
    server.tool(
        "get-vehicle-characteristics",
        "Get detailed vehicle configuration characteristics. You can specify either tank_id OR tank_name.",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .optional()
                .default("xbox")
                .describe(
                    "Gaming platform (xbox or ps4) - defaults to xbox since vehicle data is identical across platforms"
                ),
            tank_id: z
                .number()
                .optional()
                .describe(
                    "Vehicle ID to get characteristics for (use either tank_id OR tank_name)"
                ),
            tank_name: z
                .string()
                .optional()
                .describe(
                    "Vehicle name to search for (use either tank_id OR tank_name, e.g., 'IS-7', 'Tiger II')"
                ),
            engine_id: z
                .number()
                .optional()
                .describe(
                    "Engine ID. If not specified, standard module is used"
                ),
            gun_id: z
                .number()
                .optional()
                .describe("Gun ID. If not specified, standard module is used"),
            radio_id: z
                .number()
                .optional()
                .describe(
                    "Radio ID. If not specified, standard module is used"
                ),
            suspension_id: z
                .number()
                .optional()
                .describe(
                    "Suspension ID. If not specified, standard module is used"
                ),
            turret_id: z
                .number()
                .optional()
                .describe(
                    "Turret ID. If not specified, standard module is used"
                ),
            profile_id: z
                .string()
                .optional()
                .describe(
                    "Configuration ID. If specified, individual module IDs are ignored"
                ),
            language: z
                .string()
                .optional()
                .default("en")
                .describe("Localization language (en, ru, pl, de, fr, es, tr)"),
        },
        async ({
            platform = "xbox",
            tank_id,
            tank_name,
            engine_id,
            gun_id,
            radio_id,
            suspension_id,
            turret_id,
            profile_id,
            language = "en",
        }) => {
            // Validate that either tank_id or tank_name is provided
            if (!tank_id && !tank_name) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "❌ Error: You must specify either tank_id or tank_name",
                        },
                    ],
                };
            }

            let actualTankId = tank_id;

            // If tank_name is provided, search for the tank to get its ID
            if (tank_name && !tank_id) {
                const matchingVehicles = await findTanksByName(
                    platform,
                    tank_name
                );

                if (matchingVehicles.length === 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `❌ No tank found matching "${tank_name}" on ${platform.toUpperCase()}. Try searching with partial names like "IS" for IS-7.`,
                            },
                        ],
                    };
                }

                if (matchingVehicles.length > 1) {
                    const tankList = matchingVehicles
                        .slice(0, 5)
                        .map(
                            (vehicle) =>
                                `• ${vehicle.name} (ID: ${vehicle.tank_id}, Tier ${vehicle.tier})`
                        )
                        .join("\n");

                    return {
                        content: [
                            {
                                type: "text",
                                text: `❌ Multiple tanks found matching "${tank_name}". Please be more specific or use tank_id instead:\n\n${tankList}${
                                    matchingVehicles.length > 5
                                        ? "\n... and more"
                                        : ""
                                }`,
                            },
                        ],
                    };
                }

                actualTankId = matchingVehicles[0].tank_id;
            }

            const params: Record<string, string | number> = {
                tank_id: actualTankId!,
                language,
            };

            if (profile_id) {
                params.profile_id = profile_id;
            } else {
                if (engine_id) params.engine_id = engine_id;
                if (gun_id) params.gun_id = gun_id;
                if (radio_id) params.radio_id = radio_id;
                if (suspension_id) params.suspension_id = suspension_id;
                if (turret_id) params.turret_id = turret_id;
            }

            const response = await makeWargamingRequest<
                WargamingResponse<{ [key: string]: VehicleProfile }>
            >(platform, "/wotx/encyclopedia/vehicleprofile/", params);

            if (!response || response.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to get vehicle characteristics: ${
                                response?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const characteristics = response.data[actualTankId!.toString()];
            if (!characteristics) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No characteristics data found for tank ${
                                tank_name
                                    ? `"${tank_name}"`
                                    : `ID ${actualTankId}`
                            }`,
                        },
                    ],
                };
            }

            let resultText = `**Vehicle Characteristics${
                tank_name ? ` for ${tank_name}` : ""
            } (Tank ID: ${actualTankId})**\n`;
            resultText += `Configuration: ${
                characteristics.is_default ? "Default" : "Custom"
            } (Profile ID: ${characteristics.profile_id})\n\n`;

            // Basic stats
            resultText += `**Basic Statistics:**\n`;
            resultText += `• HP: ${characteristics.hp} (Hull: ${characteristics.hull_hp})\n`;
            resultText += `• Weight: ${characteristics.weight}kg (Hull: ${characteristics.hull_weight}kg, Max: ${characteristics.max_weight}kg)\n`;
            resultText += `• Speed: ${characteristics.speed_forward}km/h forward, ${characteristics.speed_backward}km/h reverse\n`;
            resultText += `• Max Ammo: ${characteristics.max_ammo}\n\n`;

            // Armor
            if (characteristics.armor) {
                resultText += `**Armor:**\n`;
                if (characteristics.armor.hull) {
                    resultText += `• Hull: ${characteristics.armor.hull.front}mm front, ${characteristics.armor.hull.sides}mm sides, ${characteristics.armor.hull.rear}mm rear\n`;
                }
                if (characteristics.armor.turret) {
                    resultText += `• Turret: ${characteristics.armor.turret.front}mm front, ${characteristics.armor.turret.sides}mm sides, ${characteristics.armor.turret.rear}mm rear\n`;
                }
                resultText += `\n`;
            }

            // Gun characteristics
            if (characteristics.gun) {
                const gun = characteristics.gun;
                resultText += `**Gun: ${gun.name}** (Tier ${gun.tier})\n`;
                resultText += `• Caliber: ${gun.caliber}mm | Weight: ${gun.weight}kg\n`;
                resultText += `• Aim Time: ${gun.aim_time}s | Reload: ${gun.reload_time}s\n`;
                resultText += `• Fire Rate: ${gun.fire_rate.toFixed(
                    1
                )} rounds/min\n`;
                resultText += `• Dispersion: ${gun.dispersion}m at 100m\n`;
                resultText += `• Gun Arc: +${gun.move_up_arc}° / -${gun.move_down_arc}°\n`;
                resultText += `• Traverse: ${gun.traverse_speed}°/s\n\n`;
            }

            // Ammo characteristics
            if (characteristics.ammo && characteristics.ammo.length > 0) {
                resultText += `**Ammunition (${characteristics.ammo.length} types):**\n`;
                characteristics.ammo.forEach((ammo, index) => {
                    resultText += `${index + 1}. **${ammo.type}**\n`;
                    if (ammo.damage && ammo.damage.length >= 3) {
                        resultText += `   • Damage: ${ammo.damage[0]}-${ammo.damage[2]} (avg: ${ammo.damage[1]})\n`;
                    }
                    if (ammo.penetration && ammo.penetration.length >= 3) {
                        resultText += `   • Penetration: ${ammo.penetration[0]}-${ammo.penetration[2]}mm (avg: ${ammo.penetration[1]}mm)\n`;
                    }
                });
                resultText += `\n`;
            }

            // Engine
            if (characteristics.engine) {
                const engine = characteristics.engine;
                resultText += `**Engine: ${engine.name}** (Tier ${engine.tier})\n`;
                resultText += `• Power: ${engine.power}hp | Weight: ${engine.weight}kg\n`;
                resultText += `• Fire Chance: ${(
                    engine.fire_chance * 100
                ).toFixed(1)}%\n\n`;
            }

            // Turret
            if (characteristics.turret) {
                const turret = characteristics.turret;
                resultText += `**Turret: ${turret.name}** (Tier ${turret.tier})\n`;
                resultText += `• HP: ${turret.hp} | Weight: ${turret.weight}kg\n`;
                resultText += `• View Range: ${turret.view_range}m\n`;
                resultText += `• Traverse: ${turret.traverse_speed}°/s\n`;
                resultText += `• Arc: ${turret.traverse_left_arc}° left to ${turret.traverse_right_arc}° right\n\n`;
            }

            // Radio
            if (characteristics.radio) {
                const radio = characteristics.radio;
                resultText += `**Radio: ${radio.name}** (Tier ${radio.tier})\n`;
                resultText += `• Signal Range: ${radio.signal_range}m | Weight: ${radio.weight}kg\n\n`;
            }

            // Suspension
            if (characteristics.suspension) {
                const suspension = characteristics.suspension;
                resultText += `**Suspension: ${suspension.name}** (Tier ${suspension.tier})\n`;
                resultText += `• Load Limit: ${suspension.load_limit}kg | Weight: ${suspension.weight}kg\n`;
                resultText += `• Traverse Speed: ${suspension.traverse_speed}°/s\n`;
                if (suspension.steering_lock_angle) {
                    resultText += `• Steering Lock: ${suspension.steering_lock_angle}°\n`;
                }
                resultText += `\n`;
            }

            // Module IDs
            if (characteristics.modules) {
                resultText += `**Mounted Module IDs:**\n`;
                resultText += `• Engine: ${characteristics.modules.engine_id} | Gun: ${characteristics.modules.gun_id}\n`;
                resultText += `• Radio: ${characteristics.modules.radio_id} | Suspension: ${characteristics.modules.suspension_id}\n`;
                resultText += `• Turret: ${characteristics.modules.turret_id}\n`;
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

    // Tool: Search tanks by name
    server.tool(
        "search-tanks-by-name",
        "Search for specific tanks by name (e.g., IS-7, Tiger II, T-54)",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            tank_name: z
                .string()
                .describe(
                    "Tank name to search for (e.g., 'IS-7', 'Tiger', 'Sherman')"
                ),
            exact_match: z
                .boolean()
                .optional()
                .default(false)
                .describe(
                    "Whether to search for exact name match or partial match"
                ),
        },
        async ({ platform, tank_name, exact_match = false }) => {
            const { vehicles, error } = await getVehicleMap(platform);

            if (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to search tanks: ${error}`,
                        },
                    ],
                };
            }

            const searchTerm = tank_name.toLowerCase();

            // Filter vehicles by name
            const matchingVehicles = [...vehicles.values()].filter(
                (vehicle) => {
                    if (exact_match) {
                        const vehicleName = vehicle.name.toLowerCase();
                        const shortName =
                            vehicle.short_name?.toLowerCase() || "";
                        return (
                            vehicleName === searchTerm ||
                            shortName === searchTerm
                        );
                    }
                    return matchesVehicleName(vehicle, tank_name);
                }
            );

            if (matchingVehicles.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No tanks found matching "${tank_name}" on ${platform.toUpperCase()}.\n\nTry searching for:\n• Part of the name (e.g., "IS" for IS-7)\n• Alternative spellings\n• Set exact_match to false for broader search`,
                        },
                    ],
                };
            }

            let resultText = `Found ${
                matchingVehicles.length
            } tank(s) matching "${tank_name}" on ${platform.toUpperCase()}:\n\n`;

            // Sort by tier and name for better presentation
            const sortedVehicles = matchingVehicles.sort((a, b) => {
                if (a.tier !== b.tier) return a.tier - b.tier;
                return a.name.localeCompare(b.name);
            });

            sortedVehicles.forEach((vehicle) => {
                resultText += `• **${vehicle.name}** (Tank ID: ${vehicle.tank_id})\n`;
                resultText += `  Tier: ${
                    vehicle.tier
                } | Nation: ${vehicle.nation.toUpperCase()} | Type: ${
                    vehicle.type
                }\n`;
                if (vehicle.short_name) {
                    resultText += `  Short Name: ${vehicle.short_name}\n`;
                }
                if (vehicle.is_premium) {
                    resultText += `  ⭐ Premium Tank\n`;
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
}
