// High-level report tools that orchestrate multiple API calls into a
// single, readable answer.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeWargamingRequest, Platform } from "../api.js";
import { formatNumber, percent } from "../format.js";
import {
    getVehicleMap,
    matchesVehicleName,
    tankLabel,
} from "../encyclopedia-cache.js";
import type {
    PlayerInfo,
    PlayerStats,
    PlayerVehicleStats,
    VehicleInfo,
    VehicleProfile,
    WargamingResponse,
} from "../types.js";

interface PlayerClanMembership {
    clan_id: number;
    role_i18n: string;
    joined_at: number;
    clan: { name: string; tag: string; members_count: number };
}

// Resolve a tank query (name or numeric ID) to a single vehicle,
// or return an error message describing what went wrong.
async function resolveTank(
    platform: Platform,
    query: string
): Promise<{ vehicle?: VehicleInfo; error?: string }> {
    const trimmed = query.trim();

    const { vehicles, error } = await getVehicleMap(platform);
    if (error) return { error: `Failed to load vehicle data: ${error}` };

    if (/^\d+$/.test(trimmed)) {
        const vehicle = vehicles.get(parseInt(trimmed));
        return vehicle
            ? { vehicle }
            : { error: `No tank found with ID ${trimmed}` };
    }

    const matches = [...vehicles.values()].filter((vehicle) =>
        matchesVehicleName(vehicle, trimmed)
    );
    if (matches.length === 0) {
        return { error: `No tank found matching "${trimmed}"` };
    }
    if (matches.length === 1) {
        return { vehicle: matches[0] };
    }

    // Multiple matches — prefer a single exact name/short-name match
    const q = trimmed.toLowerCase();
    const exact = matches.filter(
        (v) =>
            v.name.toLowerCase() === q || v.short_name?.toLowerCase() === q
    );
    if (exact.length === 1) {
        return { vehicle: exact[0] };
    }

    const options = matches
        .slice(0, 5)
        .map((v) => `${v.name} (ID ${v.tank_id}, Tier ${v.tier})`)
        .join("; ");
    return {
        error: `Multiple tanks match "${trimmed}": ${options}${
            matches.length > 5 ? "; ..." : ""
        } — be more specific or use the tank ID`,
    };
}

async function getVehicleProfile(
    platform: Platform,
    tankId: number
): Promise<VehicleProfile | null> {
    const response = await makeWargamingRequest<
        WargamingResponse<{ [key: string]: VehicleProfile }>
    >(platform, "/wotx/encyclopedia/vehicleprofile/", { tank_id: tankId });
    if (!response || response.status === "error") return null;
    return response.data?.[tankId.toString()] ?? null;
}

export function registerReportTools(server: McpServer): void {
    // Tool: One-shot player report by nickname
    server.tool(
        "get-player-report",
        "Get a complete player report in one call: search by nickname, then combine overall statistics, derived performance metrics, top tanks, best performers, and clan membership",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            nickname: z
                .string()
                .describe(
                    "Player nickname (exact match preferred, otherwise the closest search result is used)"
                ),
        },
        async ({ platform, nickname }) => {
            // 1. Find the account
            const search = await makeWargamingRequest<
                WargamingResponse<PlayerInfo[]>
            >(platform, "/wotx/account/list/", { search: nickname, limit: 10 });

            if (!search || search.status === "error") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to search for player "${nickname}": ${
                                search?.error?.message || "Unknown error"
                            }`,
                        },
                    ],
                };
            }

            const candidates = search.data || [];
            if (candidates.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No players found matching "${nickname}" on ${platform.toUpperCase()}`,
                        },
                    ],
                };
            }

            const exact = candidates.find(
                (p) => p.nickname.toLowerCase() === nickname.toLowerCase()
            );
            const player = exact || candidates[0];
            const matchNote =
                !exact && candidates.length > 1
                    ? `\n*Closest match for "${nickname}" — other results: ${candidates
                          .filter((p) => p !== player)
                          .slice(0, 3)
                          .map((p) => p.nickname)
                          .join(", ")}*\n`
                    : "";

            // 2. Fetch everything else in parallel
            const accountId = player.account_id;
            const [statsRes, tanksRes, clanRes, { vehicles }] =
                await Promise.all([
                    makeWargamingRequest<
                        WargamingResponse<{ [key: string]: PlayerStats }>
                    >(platform, "/wotx/account/info/", {
                        account_id: accountId,
                    }),
                    makeWargamingRequest<
                        WargamingResponse<{
                            [key: string]: PlayerVehicleStats[];
                        }>
                    >(platform, "/wotx/account/tanks/", {
                        account_id: accountId,
                    }),
                    makeWargamingRequest<
                        WargamingResponse<{
                            [key: string]: PlayerClanMembership | null;
                        }>
                    >(platform, "/wotx/clans/accountinfo/", {
                        account_id: accountId,
                    }),
                    getVehicleMap(platform),
                ]);

            let report = `**Player Report: ${
                player.nickname
            }** (ID: ${accountId}, ${platform.toUpperCase()})\n${matchNote}\n`;

            // Clan membership
            const clanData = clanRes?.data?.[accountId.toString()];
            if (clanData?.clan_id && clanData.clan) {
                const joined = new Date(
                    clanData.joined_at * 1000
                ).toLocaleDateString();
                report += `**Clan:** [${clanData.clan.tag}] ${clanData.clan.name} — ${clanData.role_i18n}, joined ${joined}\n\n`;
            } else {
                report += `**Clan:** none\n\n`;
            }

            // Overall stats + derived metrics
            const stats =
                statsRes?.data?.[accountId.toString()]?.statistics?.all;
            if (stats && stats.battles > 0) {
                const avgDamage = (stats.damage_dealt / stats.battles).toFixed(
                    0
                );
                const damageRatio =
                    stats.damage_received > 0
                        ? (stats.damage_dealt / stats.damage_received).toFixed(
                              2
                          )
                        : "N/A";
                const fragsPerBattle = (stats.frags / stats.battles).toFixed(
                    2
                );

                report += `**Overall Performance:**\n`;
                report += `• Battles: ${formatNumber(stats.battles)}\n`;
                report += `• Win Rate: ${percent(
                    stats.wins,
                    stats.battles
                )}%\n`;
                if (stats.survived_battles !== undefined) {
                    report += `• Survival Rate: ${percent(
                        stats.survived_battles,
                        stats.battles
                    )}%\n`;
                }
                report += `• Average Damage: ${formatNumber(
                    Number(avgDamage)
                )}\n`;
                report += `• Damage Ratio (dealt/received): ${damageRatio}\n`;
                report += `• Frags per Battle: ${fragsPerBattle}\n`;
                if (stats.xp !== undefined && stats.xp > 0) {
                    report += `• Average XP: ${formatNumber(
                        Math.round(stats.xp / stats.battles)
                    )}\n`;
                }
                report += `\n`;
            } else {
                report += `**Overall Performance:** no battle data available${
                    statsRes?.error?.message
                        ? ` (${statsRes.error.message})`
                        : ""
                }\n\n`;
            }

            // Per-tank breakdown
            const playerTanks = tanksRes?.data?.[accountId.toString()] || [];
            if (playerTanks.length > 0) {
                report += `**Vehicles Played:** ${playerTanks.length}\n\n`;

                const byBattles = [...playerTanks].sort(
                    (a, b) =>
                        (b.statistics.all.battles || 0) -
                        (a.statistics.all.battles || 0)
                );

                report += `**Top 5 Tanks by Battles:**\n`;
                byBattles.slice(0, 5).forEach((tank, i) => {
                    const s = tank.statistics.all;
                    report += `${i + 1}. ${tankLabel(
                        vehicles,
                        tank.tank_id
                    )}: ${formatNumber(s.battles)} battles, ${percent(
                        s.wins,
                        s.battles,
                        1
                    )}% WR\n`;
                });

                const experienced = byBattles.filter(
                    (t) => t.statistics.all.battles >= 20
                );
                if (experienced.length > 0) {
                    const bestByWinRate = [...experienced].sort(
                        (a, b) =>
                            b.statistics.all.wins / b.statistics.all.battles -
                            a.statistics.all.wins / a.statistics.all.battles
                    );
                    report += `\n**Best Performers (min. 20 battles):**\n`;
                    bestByWinRate.slice(0, 3).forEach((tank, i) => {
                        const s = tank.statistics.all;
                        report += `${i + 1}. ${tankLabel(
                            vehicles,
                            tank.tank_id
                        )}: ${percent(s.wins, s.battles, 1)}% WR over ${
                            s.battles
                        } battles\n`;
                    });
                }
            } else {
                report += `**Vehicles:** no per-tank data available\n`;
            }

            return {
                content: [
                    {
                        type: "text",
                        text: report.trim(),
                    },
                ],
            };
        }
    );

    // Tool: Compare two tanks side by side
    server.tool(
        "compare-tanks",
        "Compare two tanks side by side (armor, firepower, mobility, view range) using their default configurations. Accepts tank names or IDs.",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .optional()
                .default("xbox")
                .describe(
                    "Gaming platform (xbox or ps4) - defaults to xbox since vehicle data is identical across platforms"
                ),
            tank_a: z
                .string()
                .describe("First tank name or ID (e.g., 'IS-7' or '7169')"),
            tank_b: z
                .string()
                .describe("Second tank name or ID (e.g., 'Maus')"),
        },
        async ({ platform = "xbox", tank_a, tank_b }) => {
            const [resolvedA, resolvedB] = await Promise.all([
                resolveTank(platform, tank_a),
                resolveTank(platform, tank_b),
            ]);

            const errors = [resolvedA.error, resolvedB.error].filter(Boolean);
            if (errors.length > 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `❌ ${errors.join("\n❌ ")}`,
                        },
                    ],
                };
            }

            const vehicleA = resolvedA.vehicle!;
            const vehicleB = resolvedB.vehicle!;

            const [profileA, profileB] = await Promise.all([
                getVehicleProfile(platform, vehicleA.tank_id),
                getVehicleProfile(platform, vehicleB.tank_id),
            ]);

            if (!profileA || !profileB) {
                const missing = [
                    !profileA ? vehicleA.name : null,
                    !profileB ? vehicleB.name : null,
                ]
                    .filter(Boolean)
                    .join(", ");
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to load the configuration profile for: ${missing}`,
                        },
                    ],
                };
            }

            const armor = (p: VehicleProfile, part: "hull" | "turret") => {
                const a = p.armor?.[part];
                return a ? `${a.front}/${a.sides}/${a.rear}` : "—";
            };
            const firstAmmo = (p: VehicleProfile) => p.ammo?.[0];
            const powerToWeight = (p: VehicleProfile) =>
                p.engine && p.weight > 0
                    ? (p.engine.power / (p.weight / 1000)).toFixed(1)
                    : "—";

            const rows: Array<[string, string, string]> = [
                [
                    "Tier / Nation",
                    `${vehicleA.tier} / ${vehicleA.nation.toUpperCase()}`,
                    `${vehicleB.tier} / ${vehicleB.nation.toUpperCase()}`,
                ],
                ["Type", vehicleA.type, vehicleB.type],
                ["HP", `${profileA.hp}`, `${profileB.hp}`],
                [
                    "Hull armor F/S/R (mm)",
                    armor(profileA, "hull"),
                    armor(profileB, "hull"),
                ],
                [
                    "Turret armor F/S/R (mm)",
                    armor(profileA, "turret"),
                    armor(profileB, "turret"),
                ],
                [
                    "Gun",
                    profileA.gun?.name ?? "—",
                    profileB.gun?.name ?? "—",
                ],
                [
                    "Avg damage",
                    `${firstAmmo(profileA)?.damage?.[1] ?? "—"}`,
                    `${firstAmmo(profileB)?.damage?.[1] ?? "—"}`,
                ],
                [
                    "Avg penetration (mm)",
                    `${firstAmmo(profileA)?.penetration?.[1] ?? "—"}`,
                    `${firstAmmo(profileB)?.penetration?.[1] ?? "—"}`,
                ],
                [
                    "Reload (s)",
                    `${profileA.gun?.reload_time ?? "—"}`,
                    `${profileB.gun?.reload_time ?? "—"}`,
                ],
                [
                    "Aim time (s)",
                    `${profileA.gun?.aim_time ?? "—"}`,
                    `${profileB.gun?.aim_time ?? "—"}`,
                ],
                [
                    "Dispersion @100m",
                    `${profileA.gun?.dispersion ?? "—"}`,
                    `${profileB.gun?.dispersion ?? "—"}`,
                ],
                [
                    "Top speed fwd/rev (km/h)",
                    `${profileA.speed_forward}/${profileA.speed_backward}`,
                    `${profileB.speed_forward}/${profileB.speed_backward}`,
                ],
                [
                    "Engine power (hp)",
                    `${profileA.engine?.power ?? "—"}`,
                    `${profileB.engine?.power ?? "—"}`,
                ],
                [
                    "Power/weight (hp/t)",
                    powerToWeight(profileA),
                    powerToWeight(profileB),
                ],
                [
                    "View range (m)",
                    `${profileA.turret?.view_range ?? "—"}`,
                    `${profileB.turret?.view_range ?? "—"}`,
                ],
                [
                    "Signal range (m)",
                    `${profileA.radio?.signal_range ?? "—"}`,
                    `${profileB.radio?.signal_range ?? "—"}`,
                ],
                [
                    "Ammo capacity",
                    `${profileA.max_ammo}`,
                    `${profileB.max_ammo}`,
                ],
            ];

            let table = `**Tank Comparison (default configurations)**\n\n`;
            table += `| | **${vehicleA.name}** | **${vehicleB.name}** |\n`;
            table += `| --- | --- | --- |\n`;
            rows.forEach(([label, a, b]) => {
                table += `| ${label} | ${a} | ${b} |\n`;
            });
            table += `\n*Avg damage/penetration use each tank's first (standard) shell type.*`;

            return {
                content: [
                    {
                        type: "text",
                        text: table,
                    },
                ],
            };
        }
    );
}
