#!/usr/bin/env node

import dotenv from "dotenv";

// Load environment variables
dotenv.config({ quiet: true });

const API_KEY = process.env.WARGAMING_API_KEY;
const BASE_URL = "https://api-modernarmor.worldoftanks.com";

if (!API_KEY) {
    console.error("❌ WARGAMING_API_KEY not found in .env file");
    process.exit(1);
}

// Safely format numbers that may be missing from API responses
function formatNumber(value) {
    return value !== null && value !== undefined
        ? value.toLocaleString()
        : "N/A";
}

async function makeRequest(endpoint, params = {}) {
    const url = new URL(endpoint, BASE_URL);
    url.searchParams.append("application_id", API_KEY);

    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
    });

    try {
        const response = await fetch(url.toString());
        const data = await response.json();
        if (data?.status === "error") {
            console.error(
                `❌ API Error ${data.error?.code || ""}: ${
                    data.error?.message || "unknown error"
                }`
            );
            return null;
        }
        return data;
    } catch (error) {
        console.error("❌ API Error:", error.message);
        return null;
    }
}

// CLI Commands
async function searchPlayers(search, platform = "xbox", limit = 5) {
    console.log(
        `🔍 Searching for players with "${search}" on ${platform.toUpperCase()}...\n`
    );

    const data = await makeRequest("/wotx/account/list/", { search, limit });

    if (data?.status === "ok" && data.data?.length > 0) {
        console.log(`✅ Found ${data.data.length} player(s):`);
        data.data.forEach((player, i) => {
            console.log(
                `${i + 1}. ${player.nickname} (ID: ${player.account_id})`
            );
        });
    } else {
        console.log("❌ No players found");
    }
}

async function getPlayerStats(accountId, platform = "xbox") {
    console.log(
        `📊 Getting stats for player ID ${accountId} on ${platform.toUpperCase()}...\n`
    );

    const data = await makeRequest("/wotx/account/info/", {
        account_id: accountId,
    });

    if (data?.status === "ok" && data.data?.[accountId]) {
        const stats = data.data[accountId].statistics?.all;
        if (stats) {
            const winRate =
                stats.battles > 0
                    ? ((stats.wins / stats.battles) * 100).toFixed(2)
                    : "0.00";

            console.log(`✅ Player Statistics:`);
            console.log(`   Battles: ${formatNumber(stats.battles)}`);
            console.log(`   Win Rate: ${winRate}%`);
            console.log(`   Average Damage: ${formatNumber(stats.avg_damage)}`);
            console.log(`   Frags: ${formatNumber(stats.frags)}`);
        }
    } else {
        console.log("❌ Player stats not found");
    }
}

async function searchVehicles(
    tier = null,
    nation = null,
    type = null,
    limit = 10
) {
    console.log(`🚗 Searching for vehicles...`);
    if (tier) console.log(`   Tier: ${tier}`);
    if (nation) console.log(`   Nation: ${nation}`);
    if (type) console.log(`   Type: ${type}`);
    console.log();

    const params = { limit };
    if (tier) params.tier = tier;
    if (nation) params.nation = nation;
    if (type) params.type = type;

    const data = await makeRequest("/wotx/encyclopedia/vehicles/", params);

    if (data?.status === "ok" && data.data) {
        const vehicles = Object.values(data.data);
        console.log(`✅ Found ${vehicles.length} vehicle(s):`);
        vehicles.forEach((vehicle, i) => {
            console.log(
                `${i + 1}. ${vehicle.name} (Tier ${
                    vehicle.tier
                }, ${vehicle.nation.toUpperCase()}, ${vehicle.type})`
            );
        });
    } else {
        console.log("❌ No vehicles found");
    }
}

async function searchClans(search, platform = "xbox", limit = 5) {
    console.log(
        `🏰 Searching for clans with "${search}" on ${platform.toUpperCase()}...\n`
    );

    const data = await makeRequest("/wotx/clans/list/", { search, limit });

    if (data?.status === "ok" && data.data?.length > 0) {
        console.log(`✅ Found ${data.data.length} clan(s):`);
        data.data.forEach((clan, i) => {
            const createdDate = new Date(
                clan.created_at * 1000
            ).toLocaleDateString();
            console.log(`${i + 1}. [${clan.tag}] ${clan.name}`);
            console.log(
                `   Members: ${clan.members_count} | Created: ${createdDate} | ID: ${clan.clan_id}`
            );
        });
    } else {
        console.log("❌ No clans found");
    }
}

async function getPlayerAchievements(accountId, platform = "xbox") {
    console.log(
        `🏆 Getting achievements for player ID ${accountId} on ${platform.toUpperCase()}...\n`
    );

    const data = await makeRequest("/wotx/account/achievements/", {
        account_id: accountId,
    });

    if (data?.status === "ok" && data.data?.[accountId]) {
        const achievements = data.data[accountId].achievements;
        const achievementCount = Object.keys(achievements).length;

        if (achievementCount === 0) {
            console.log("❌ Player has no achievements yet");
            return;
        }

        console.log(`✅ Player Achievements (${achievementCount} total):`);

        // Show first 10 achievements
        Object.entries(achievements)
            .slice(0, 10)
            .forEach(([achievementId, count], i) => {
                console.log(
                    `   ${i + 1}. Achievement ${achievementId}: ${count}`
                );
            });

        if (achievementCount > 10) {
            console.log(
                `   ... and ${achievementCount - 10} more achievements`
            );
        }
    } else {
        console.log("❌ Player achievements not found");
    }
}

async function getPlayerVehicles(accountId, tankId = null, platform = "xbox") {
    console.log(
        `🚗 Getting vehicle stats for player ID ${accountId} on ${platform.toUpperCase()}...\n`
    );

    const params = { account_id: accountId };
    if (tankId) params.tank_id = tankId;

    const data = await makeRequest("/wotx/account/tanks/", params);

    if (data?.status === "ok" && data.data?.[accountId]) {
        const vehicles = data.data[accountId];

        if (vehicles.length === 0) {
            console.log("❌ No vehicle data found");
            return;
        }

        if (tankId) {
            // Show specific tank stats
            const tankStats = vehicles.find(
                (v) => v.tank_id === parseInt(tankId)
            );
            if (tankStats) {
                const stats = tankStats.statistics.all;
                const winRate =
                    stats.battles > 0
                        ? ((stats.wins / stats.battles) * 100).toFixed(2)
                        : "0.00";

                console.log(`✅ Tank ID ${tankId} Statistics:`);
                console.log(`   Battles: ${formatNumber(stats.battles)}`);
                console.log(`   Win Rate: ${winRate}%`);
                console.log(
                    `   Average Damage: ${formatNumber(stats.avg_damage)}`
                );
                console.log(`   Max Damage: ${formatNumber(stats.max_damage)}`);
                console.log(`   Frags: ${formatNumber(stats.frags)}`);
                console.log(`   Mark of Mastery: ${stats.mark_of_mastery}`);
            } else {
                console.log(`❌ No stats found for tank ID ${tankId}`);
            }
        } else {
            // Show vehicle summary
            console.log(`✅ Player has ${vehicles.length} vehicles:`);

            const topVehicles = vehicles
                .sort(
                    (a, b) =>
                        (b.statistics.all.battles || 0) -
                        (a.statistics.all.battles || 0)
                )
                .slice(0, 10);

            console.log("   Top vehicles by battles:");
            topVehicles.forEach((vehicle, i) => {
                const stats = vehicle.statistics.all;
                const winRate =
                    stats.battles > 0
                        ? ((stats.wins / stats.battles) * 100).toFixed(1)
                        : "0.0";
                console.log(
                    `   ${i + 1}. Tank ID ${vehicle.tank_id}: ${formatNumber(
                        stats.battles
                    )} battles, ${winRate}% WR`
                );
            });
        }
    } else {
        console.log("❌ Player vehicle data not found");
    }
}

async function getTankDetails(tankId, platform = "xbox") {
    console.log(
        `🔍 Getting details for tank ID ${tankId} on ${platform.toUpperCase()}...\n`
    );

    const data = await makeRequest("/wotx/encyclopedia/vehicles/", {
        tank_id: tankId,
    });

    if (data?.status === "ok" && data.data?.[tankId]) {
        const tank = data.data[tankId];

        console.log(`✅ Tank Details:`);
        console.log(`   Name: ${tank.name}`);
        console.log(`   Nation: ${tank.nation.toUpperCase()}`);
        console.log(`   Type: ${tank.type}`);
        console.log(`   Tier: ${tank.tier}`);
        console.log(`   Max Health: ${formatNumber(tank.max_health)} HP`);
        console.log(`   Max Speed: ${formatNumber(tank.speed_limit)} km/h`);
        console.log(`   Weight: ${formatNumber(tank.weight)} kg`);
        console.log(`   Credit Price: ${formatNumber(tank.price_credit)}`);
        if (tank.price_gold > 0) {
            console.log(`   Gold Price: ${formatNumber(tank.price_gold)}`);
        }
    } else {
        console.log("❌ Tank details not found");
    }
}

async function getTankModules(
    moduleType,
    nation = null,
    tier = null,
    limit = 10
) {
    console.log(`🔧 Getting ${moduleType}...`);
    if (nation) console.log(`   Nation: ${nation}`);
    if (tier) console.log(`   Tier: ${tier}`);
    console.log();

    const params = { limit };
    if (nation) params.nation = nation;
    if (tier) params.tier = tier;

    const data = await makeRequest(`/wotx/encyclopedia/${moduleType}/`, params);

    if (data?.status === "ok" && data.data) {
        const modules = Object.values(data.data);

        console.log(`✅ Found ${modules.length} ${moduleType}:`);
        modules.slice(0, limit).forEach((module, i) => {
            console.log(
                `${i + 1}. ${module.name} (Tier ${
                    module.tier
                }, ${module.nation.toUpperCase()})`
            );
            console.log(
                `   Credit Price: ${formatNumber(module.price_credit)}`
            );
        });
    } else {
        console.log(`❌ No ${moduleType} found`);
    }
}

async function getMaps(platform = "xbox") {
    console.log(`🗺️ Getting maps for ${platform.toUpperCase()}...\n`);

    const data = await makeRequest("/wotx/encyclopedia/arenas/", {});

    if (data?.status === "ok" && data.data) {
        const maps = Object.values(data.data);
        console.log(`✅ Found ${maps.length} maps:`);
        maps.slice(0, 20).forEach((map, i) => {
            console.log(`${i + 1}. ${map.name_i18n || map.arena_id}`);
        });

        if (maps.length > 20) {
            console.log(`... and ${maps.length - 20} more maps`);
        }
    } else {
        console.log("❌ No maps found");
    }
}

// Add a new command for vehicle characteristics by name
async function getVehicleCharacteristics(tankNameOrId, platform = "xbox") {
    console.log(`🔍 Getting characteristics for "${tankNameOrId}"...\n`);

    let tankId = tankNameOrId;

    // If it's not a pure number, search for the tank by name
    if (isNaN(tankNameOrId)) {
        console.log(`🔍 Searching for tank named "${tankNameOrId}"...`);

        const vehiclesData = await makeRequest(
            "/wotx/encyclopedia/vehicles/",
            {}
        );

        if (vehiclesData?.status === "ok" && vehiclesData.data) {
            const searchTerm = tankNameOrId.toLowerCase();
            const allVehicles = Object.entries(vehiclesData.data);

            const matchingVehicles = allVehicles.filter(([id, vehicle]) => {
                const vehicleName = vehicle.name.toLowerCase();
                const shortName = vehicle.short_name?.toLowerCase() || "";

                return (
                    vehicleName.includes(searchTerm) ||
                    shortName.includes(searchTerm) ||
                    vehicleName
                        .replace(/[-\s]/g, "")
                        .includes(searchTerm.replace(/[-\s]/g, ""))
                );
            });

            if (matchingVehicles.length === 0) {
                console.log(`❌ No tank found matching "${tankNameOrId}"`);
                return;
            }

            if (matchingVehicles.length > 1) {
                console.log(
                    `❌ Multiple tanks found matching "${tankNameOrId}":`
                );
                matchingVehicles.slice(0, 5).forEach(([id, vehicle], i) => {
                    console.log(
                        `   ${i + 1}. ${vehicle.name} (ID: ${id}, Tier ${
                            vehicle.tier
                        })`
                    );
                });
                console.log(
                    "\nPlease be more specific or use tank ID instead."
                );
                return;
            }

            tankId = matchingVehicles[0][0];
            console.log(
                `✅ Found: ${matchingVehicles[0][1].name} (ID: ${tankId})\n`
            );
        } else {
            console.log("❌ Failed to search for tank");
            return;
        }
    }

    // Get vehicle characteristics (platform doesn't matter for this data)
    const data = await makeRequest("/wotx/encyclopedia/vehicleprofile/", {
        tank_id: tankId,
    });

    if (data?.status === "ok" && data.data?.[tankId]) {
        const char = data.data[tankId];

        console.log(`✅ Vehicle Characteristics for Tank ID ${tankId}:`);
        console.log(
            `   HP: ${formatNumber(char.hp)} (Hull: ${formatNumber(
                char.hull_hp
            )})`
        );
        console.log(
            `   Weight: ${formatNumber(char.weight)}kg (Max: ${formatNumber(
                char.max_weight
            )}kg)`
        );
        console.log(
            `   Speed: ${formatNumber(
                char.speed_forward
            )}km/h forward, ${formatNumber(char.speed_backward)}km/h reverse`
        );
        console.log(`   Max Ammo: ${formatNumber(char.max_ammo)}`);

        if (char.armor) {
            console.log(`\n   Armor:`);
            if (char.armor.hull) {
                console.log(
                    `     Hull: ${char.armor.hull.front}mm front, ${char.armor.hull.sides}mm sides, ${char.armor.hull.rear}mm rear`
                );
            }
            if (char.armor.turret) {
                console.log(
                    `     Turret: ${char.armor.turret.front}mm front, ${char.armor.turret.sides}mm sides, ${char.armor.turret.rear}mm rear`
                );
            }
        }

        if (char.gun) {
            const gun = char.gun;
            console.log(`\n   Gun: ${gun.name} (Tier ${gun.tier})`);
            console.log(
                `     Caliber: ${gun.caliber}mm | Reload: ${gun.reload_time}s`
            );
            console.log(
                `     Aim Time: ${gun.aim_time}s | Dispersion: ${gun.dispersion}m`
            );
        }

        if (char.engine) {
            const engine = char.engine;
            console.log(`\n   Engine: ${engine.name} (Tier ${engine.tier})`);
            console.log(
                `     Power: ${engine.power}hp | Fire Chance: ${(
                    engine.fire_chance * 100
                ).toFixed(1)}%`
            );
        }
    } else {
        console.log("❌ Vehicle characteristics not found");
    }
}

// CLI Interface
const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
    case "search-players":
        if (!args[0]) {
            console.log(
                "Usage: node wot-cli.js search-players <search_term> [platform] [limit]"
            );
            process.exit(1);
        }
        await searchPlayers(args[0], args[1] || "xbox", parseInt(args[2]) || 5);
        break;

    case "player-stats":
        if (!args[0]) {
            console.log(
                "Usage: node wot-cli.js player-stats <account_id> [platform]"
            );
            process.exit(1);
        }
        await getPlayerStats(args[0], args[1] || "xbox");
        break;

    case "search-vehicles":
        const tier = args[0] ? parseInt(args[0]) : null;
        const nation = args[1] || null;
        const type = args[2] || null;
        const limit = args[3] ? parseInt(args[3]) : 10;
        await searchVehicles(tier, nation, type, limit);
        break;

    case "search-clans":
        if (!args[0]) {
            console.log(
                "Usage: node wot-cli.js search-clans <search_term> [platform] [limit]"
            );
            process.exit(1);
        }
        await searchClans(args[0], args[1] || "xbox", parseInt(args[2]) || 5);
        break;

    case "player-achievements":
        if (!args[0]) {
            console.log(
                "Usage: node wot-cli.js player-achievements <account_id> [platform]"
            );
            process.exit(1);
        }
        await getPlayerAchievements(args[0], args[1] || "xbox");
        break;

    case "player-vehicles":
        if (!args[0]) {
            console.log(
                "Usage: node wot-cli.js player-vehicles <account_id> [tank_id] [platform]"
            );
            process.exit(1);
        }
        await getPlayerVehicles(args[0], args[1] || null, args[2] || "xbox");
        break;

    case "tank-details":
        if (!args[0]) {
            console.log(
                "Usage: node wot-cli.js tank-details <tank_id> [platform]"
            );
            process.exit(1);
        }
        await getTankDetails(args[0], args[1] || "xbox");
        break;

    case "tank-modules":
        if (!args[0]) {
            console.log(
                "Usage: node wot-cli.js tank-modules <module_type> [nation] [tier] [limit]"
            );
            console.log(
                "Module types: guns, engines, radios, suspensions, turrets"
            );
            process.exit(1);
        }
        const moduleType = args[0];
        const moduleNation = args[1] || null;
        const moduleTier = args[2] ? parseInt(args[2]) : null;
        const moduleLimit = args[3] ? parseInt(args[3]) : 10;
        await getTankModules(moduleType, moduleNation, moduleTier, moduleLimit);
        break;

    case "vehicle-characteristics":
        if (!args[0]) {
            console.log(
                "Usage: node wot-cli.js vehicle-characteristics <tank_name_or_id> [platform]"
            );
            console.log("Examples:");
            console.log('  node wot-cli.js vehicle-characteristics "IS-7"');
            console.log("  node wot-cli.js vehicle-characteristics 7169");
            process.exit(1);
        }
        await getVehicleCharacteristics(args[0], args[1] || "xbox");
        break;

    case "maps":
        await getMaps(args[0] || "xbox");
        break;

    default:
        console.log(`
🎮 World of Tanks Console CLI Tool

Available commands:
  search-players <name> [platform] [limit]           - Find players by nickname
  player-stats <account_id> [platform]               - Get player statistics  
  player-achievements <account_id> [platform]        - Get player achievements
  player-vehicles <account_id> [tank_id] [platform]  - Get player vehicle stats
  search-vehicles [tier] [nation] [type] [limit]     - Find vehicles
  tank-details <tank_id> [platform]                  - Get detailed tank specifications
  vehicle-characteristics <tank_name_or_id>          - Get vehicle characteristics (works with names like "IS-7")
  tank-modules <type> [nation] [tier] [limit]        - Get tank modules (guns, engines, etc.)
  search-clans <name> [platform] [limit]             - Find clans
  maps [platform]                                     - Get battle maps list

Module types for tank-modules:
  guns, engines, radios, suspensions, turrets

Examples:
  node wot-cli.js search-players "test"
  node wot-cli.js player-stats 1088722148
  node wot-cli.js player-achievements 1088722148
  node wot-cli.js player-vehicles 1088722148 12345
  node wot-cli.js search-vehicles 10 germany
  node wot-cli.js tank-details 12345
  node wot-cli.js vehicle-characteristics "IS-7"
  node wot-cli.js tank-modules guns germany 10
  node wot-cli.js search-clans "STEEL"
  node wot-cli.js maps xbox
  node wot-cli.js vehicle-characteristics "Tiger I"
`);
        break;
}
