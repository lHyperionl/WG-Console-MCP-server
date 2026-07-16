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
import { resolvePlayerByNickname } from "../player-lookup.js";
import { saveSnapshot, type TankSnapshot } from "../snapshots.js";
import type {
    ClanDetails,
    ClanInfo,
    ClanMemberInfo,
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
            const { player, note, error } = await resolvePlayerByNickname(
                platform,
                nickname
            );
            if (error || !player) {
                return { content: [{ type: "text", text: error! }] };
            }
            const matchNote = note ? `\n*${note}*\n` : "";

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

            // Passively record a stat snapshot so progress tracking
            // (get-player-progress) accumulates history from normal use.
            // Never let storage problems break the report itself.
            const snapshotStats =
                statsRes?.data?.[accountId.toString()]?.statistics?.all;
            if (snapshotStats && snapshotStats.battles > 0) {
                const tanks: Record<string, TankSnapshot> = {};
                for (const tank of tanksRes?.data?.[accountId.toString()] ||
                    []) {
                    const s = tank.statistics.all;
                    tanks[tank.tank_id.toString()] = {
                        battles: s.battles || 0,
                        wins: s.wins || 0,
                        damage_dealt: s.damage_dealt || 0,
                        frags: s.frags || 0,
                    };
                }
                await saveSnapshot(platform, accountId, player.nickname, {
                    taken_at: Date.now(),
                    totals: {
                        battles: snapshotStats.battles || 0,
                        wins: snapshotStats.wins || 0,
                        damage_dealt: snapshotStats.damage_dealt || 0,
                        damage_received: snapshotStats.damage_received || 0,
                        frags: snapshotStats.frags || 0,
                        spots: snapshotStats.spots || 0,
                        survived_battles: snapshotStats.survived_battles,
                        xp: snapshotStats.xp,
                    },
                    tanks,
                }).catch(() => {});
            }

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

    // Tool: Compare two players side by side
    server.tool(
        "compare-players",
        "Compare two players side by side by nickname: battles, win rate, survival, average damage, damage ratio, frags, plus each player's most-played tank and best performer",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            player_a: z.string().describe("First player's nickname"),
            player_b: z.string().describe("Second player's nickname"),
        },
        async ({ platform, player_a, player_b }) => {
            const [resA, resB] = await Promise.all([
                resolvePlayerByNickname(platform, player_a),
                resolvePlayerByNickname(platform, player_b),
            ]);

            const errors = [resA.error, resB.error].filter(Boolean);
            if (errors.length > 0) {
                return {
                    content: [
                        { type: "text", text: `❌ ${errors.join("\n❌ ")}` },
                    ],
                };
            }

            const playerA = resA.player!;
            const playerB = resB.player!;
            if (playerA.account_id === playerB.account_id) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Both nicknames resolve to the same account: ${playerA.nickname} (ID ${playerA.account_id})`,
                        },
                    ],
                };
            }

            // One batched request covers both accounts' overall stats
            const [statsRes, tanksARes, tanksBRes, { vehicles }] =
                await Promise.all([
                    makeWargamingRequest<
                        WargamingResponse<{ [key: string]: PlayerStats | null }>
                    >(platform, "/wotx/account/info/", {
                        account_id: `${playerA.account_id},${playerB.account_id}`,
                    }),
                    makeWargamingRequest<
                        WargamingResponse<{
                            [key: string]: PlayerVehicleStats[];
                        }>
                    >(platform, "/wotx/account/tanks/", {
                        account_id: playerA.account_id,
                    }),
                    makeWargamingRequest<
                        WargamingResponse<{
                            [key: string]: PlayerVehicleStats[];
                        }>
                    >(platform, "/wotx/account/tanks/", {
                        account_id: playerB.account_id,
                    }),
                    getVehicleMap(platform),
                ]);

            const statsA =
                statsRes?.data?.[playerA.account_id.toString()]?.statistics
                    ?.all;
            const statsB =
                statsRes?.data?.[playerB.account_id.toString()]?.statistics
                    ?.all;
            if (!statsA || !statsB) {
                const missing = [
                    !statsA ? playerA.nickname : null,
                    !statsB ? playerB.nickname : null,
                ]
                    .filter(Boolean)
                    .join(", ");
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to load statistics for: ${missing}${
                                statsRes?.error?.message
                                    ? ` (${statsRes.error.message})`
                                    : ""
                            }`,
                        },
                    ],
                };
            }

            type Overall = typeof statsA;
            const avgDamage = (s: Overall) =>
                s.battles > 0
                    ? formatNumber(Math.round(s.damage_dealt / s.battles))
                    : "—";
            const damageRatio = (s: Overall) =>
                s.damage_received > 0
                    ? (s.damage_dealt / s.damage_received).toFixed(2)
                    : "—";
            const perBattle = (value: number, s: Overall) =>
                s.battles > 0 ? (value / s.battles).toFixed(2) : "—";
            const tanksOf = (
                res: typeof tanksARes,
                accountId: number
            ): PlayerVehicleStats[] => res?.data?.[accountId.toString()] || [];
            const mostPlayed = (tanks: PlayerVehicleStats[]) => {
                const top = [...tanks].sort(
                    (a, b) => b.statistics.all.battles - a.statistics.all.battles
                )[0];
                if (!top) return "—";
                const s = top.statistics.all;
                return `${tankLabel(vehicles, top.tank_id)} (${formatNumber(
                    s.battles
                )} battles, ${percent(s.wins, s.battles, 1)}% WR)`;
            };
            const bestPerformer = (tanks: PlayerVehicleStats[]) => {
                const top = tanks
                    .filter((t) => t.statistics.all.battles >= 20)
                    .sort(
                        (a, b) =>
                            b.statistics.all.wins / b.statistics.all.battles -
                            a.statistics.all.wins / a.statistics.all.battles
                    )[0];
                if (!top) return "—";
                const s = top.statistics.all;
                return `${tankLabel(vehicles, top.tank_id)} (${percent(
                    s.wins,
                    s.battles,
                    1
                )}% WR over ${s.battles} battles)`;
            };

            const tanksA = tanksOf(tanksARes, playerA.account_id);
            const tanksB = tanksOf(tanksBRes, playerB.account_id);

            const rows: Array<[string, string, string]> = [
                [
                    "Battles",
                    formatNumber(statsA.battles),
                    formatNumber(statsB.battles),
                ],
                [
                    "Win rate",
                    `${percent(statsA.wins, statsA.battles)}%`,
                    `${percent(statsB.wins, statsB.battles)}%`,
                ],
                [
                    "Survival rate",
                    `${percent(statsA.survived_battles, statsA.battles)}%`,
                    `${percent(statsB.survived_battles, statsB.battles)}%`,
                ],
                ["Average damage", avgDamage(statsA), avgDamage(statsB)],
                [
                    "Damage ratio (dealt/received)",
                    damageRatio(statsA),
                    damageRatio(statsB),
                ],
                [
                    "Frags per battle",
                    perBattle(statsA.frags, statsA),
                    perBattle(statsB.frags, statsB),
                ],
                [
                    "Spots per battle",
                    perBattle(statsA.spots, statsA),
                    perBattle(statsB.spots, statsB),
                ],
                [
                    "Vehicles played",
                    formatNumber(tanksA.length),
                    formatNumber(tanksB.length),
                ],
                ["Most played tank", mostPlayed(tanksA), mostPlayed(tanksB)],
                [
                    "Best performer (min 20 battles)",
                    bestPerformer(tanksA),
                    bestPerformer(tanksB),
                ],
            ];

            const notes = [resA.note, resB.note]
                .filter(Boolean)
                .map((n) => `*${n}*`)
                .join("\n");
            let table = `**Player Comparison** (${platform.toUpperCase()})\n`;
            if (notes) table += `${notes}\n`;
            table += `\n| | **${playerA.nickname}** | **${playerB.nickname}** |\n`;
            table += `| --- | --- | --- |\n`;
            rows.forEach(([label, a, b]) => {
                table += `| ${label} | ${a} | ${b} |\n`;
            });

            return { content: [{ type: "text", text: table.trim() }] };
        }
    );

    // Tool: Aggregate clan report
    server.tool(
        "get-clan-report",
        "Aggregate report for an entire clan: battle-weighted averages, member activity, top performers by win rate and by battles. Accepts a clan tag, clan name, or numeric clan ID; member stats are fetched in batched requests.",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            clan: z
                .string()
                .describe("Clan tag, clan name, or numeric clan ID"),
        },
        async ({ platform, clan }) => {
            // 1. Resolve the clan to an ID
            const trimmed = clan.trim();
            let clanId: number;
            let searchNote = "";
            if (/^\d+$/.test(trimmed)) {
                clanId = parseInt(trimmed);
            } else {
                const search = await makeWargamingRequest<
                    WargamingResponse<ClanInfo[]>
                >(platform, "/wotx/clans/list/", {
                    search: trimmed,
                    limit: 10,
                });
                if (!search || search.status === "error") {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Failed to search for clan "${trimmed}": ${
                                    search?.error?.message || "Unknown error"
                                }`,
                            },
                        ],
                    };
                }
                const clans = search.data || [];
                if (clans.length === 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `No clans found matching "${trimmed}" on ${platform.toUpperCase()}`,
                            },
                        ],
                    };
                }
                const q = trimmed.toLowerCase();
                const best =
                    clans.find((c) => c.tag?.toLowerCase() === q) ??
                    clans.find((c) => c.name?.toLowerCase() === q) ??
                    clans[0];
                clanId = best.clan_id;
                if (clans.length > 1) {
                    searchNote = `*Best match for "${trimmed}" — other results: ${clans
                        .filter((c) => c.clan_id !== best.clan_id)
                        .slice(0, 3)
                        .map((c) => `[${c.tag}] ${c.name}`)
                        .join(", ")}*\n`;
                }
            }

            // 2. Clan details incl. member list
            const infoRes = await makeWargamingRequest<
                WargamingResponse<{ [key: string]: ClanDetails | null }>
            >(platform, "/wotx/clans/info/", { clan_id: clanId });
            const details = infoRes?.data?.[clanId.toString()];
            if (!details) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No data found for clan ID ${clanId}${
                                infoRes?.error?.message
                                    ? ` (${infoRes.error.message})`
                                    : ""
                            }`,
                        },
                    ],
                };
            }

            let report = `**Clan Report: [${details.tag}] ${
                details.name
            }** (${platform.toUpperCase()}, ID ${clanId})\n${searchNote}`;
            report += `• Members: ${details.members_count} | Created: ${new Date(
                details.created_at * 1000
            ).toLocaleDateString()}\n`;

            const members = extractClanMembers(details);
            if (members.length === 0) {
                report += `\nThe API did not return a member list for this clan, so per-member statistics are unavailable.`;
                return { content: [{ type: "text", text: report }] };
            }

            // 3. Batched stats for all members (API allows up to 100 IDs/request)
            const memberIds = members.map((m) => m.account_id);
            const chunks: number[][] = [];
            for (let i = 0; i < memberIds.length; i += 100) {
                chunks.push(memberIds.slice(i, i + 100));
            }
            const statsResponses = await Promise.all(
                chunks.map((chunk) =>
                    makeWargamingRequest<
                        WargamingResponse<{ [key: string]: PlayerStats | null }>
                    >(platform, "/wotx/account/info/", {
                        account_id: chunk.join(","),
                    })
                )
            );

            interface MemberRow {
                name: string;
                role?: string;
                battles: number;
                wins: number;
                damage: number;
                lastBattle?: number;
            }
            const rows: MemberRow[] = [];
            for (const member of members) {
                let stats: PlayerStats | null | undefined;
                for (const res of statsResponses) {
                    const found = res?.data?.[member.account_id.toString()];
                    if (found) {
                        stats = found;
                        break;
                    }
                }
                const all = stats?.statistics?.all;
                if (!all) continue;
                rows.push({
                    name:
                        member.account_name ||
                        stats?.nickname ||
                        `ID ${member.account_id}`,
                    role: member.role_i18n,
                    battles: all.battles || 0,
                    wins: all.wins || 0,
                    damage: all.damage_dealt || 0,
                    lastBattle: stats?.last_battle_time,
                });
            }

            if (rows.length === 0) {
                report += `\nStatistics could not be retrieved for any of the ${members.length} members.`;
                return { content: [{ type: "text", text: report }] };
            }
            report += `• Statistics retrieved for ${rows.length} of ${members.length} members\n\n`;

            // 4. Aggregates
            const totalBattles = rows.reduce((sum, r) => sum + r.battles, 0);
            const totalWins = rows.reduce((sum, r) => sum + r.wins, 0);
            const totalDamage = rows.reduce((sum, r) => sum + r.damage, 0);
            const withBattles = rows.filter((r) => r.battles > 0);
            const meanMemberWr =
                withBattles.length > 0
                    ? withBattles.reduce(
                          (sum, r) => sum + (r.wins / r.battles) * 100,
                          0
                      ) / withBattles.length
                    : 0;

            report += `**Aggregate performance:**\n`;
            report += `• Total battles: ${formatNumber(totalBattles)}\n`;
            report += `• Battle-weighted win rate: ${percent(
                totalWins,
                totalBattles
            )}% (average member: ${meanMemberWr.toFixed(2)}%)\n`;
            report += `• Average damage per battle: ${
                totalBattles > 0
                    ? formatNumber(Math.round(totalDamage / totalBattles))
                    : "—"
            }\n`;

            // 5. Activity buckets (only if the API exposes last_battle_time)
            const withActivity = rows.filter(
                (r) => r.lastBattle !== undefined && r.lastBattle > 0
            );
            if (withActivity.length > 0) {
                const now = Date.now() / 1000;
                const within = (days: number) =>
                    withActivity.filter(
                        (r) => now - r.lastBattle! <= days * 86400
                    ).length;
                report += `\n**Activity (${withActivity.length} members with data):**\n`;
                report += `• Active in last 7 days: ${within(7)}\n`;
                report += `• Active in last 30 days: ${within(30)}\n`;
                report += `• Inactive for 30+ days: ${
                    withActivity.length - within(30)
                }\n`;
            }

            // 6. Top performers
            const MIN_BATTLES = 500;
            let qualified = withBattles.filter(
                (r) => r.battles >= MIN_BATTLES
            );
            let minNote = ` (min ${MIN_BATTLES} battles)`;
            if (qualified.length < 3) {
                qualified = withBattles;
                minNote = "";
            }
            const topByWr = [...qualified].sort(
                (a, b) => b.wins / b.battles - a.wins / a.battles
            );
            report += `\n**Top 5 by win rate${minNote}:**\n`;
            topByWr.slice(0, 5).forEach((r, i) => {
                report += `${i + 1}. ${r.name}${
                    r.role ? ` (${r.role})` : ""
                } — ${percent(r.wins, r.battles)}% WR over ${formatNumber(
                    r.battles
                )} battles, ${formatNumber(
                    Math.round(r.damage / r.battles)
                )} avg dmg\n`;
            });

            const topByBattles = [...withBattles].sort(
                (a, b) => b.battles - a.battles
            );
            report += `\n**Top 5 by battles:**\n`;
            topByBattles.slice(0, 5).forEach((r, i) => {
                report += `${i + 1}. ${r.name}${
                    r.role ? ` (${r.role})` : ""
                } — ${formatNumber(r.battles)} battles, ${percent(
                    r.wins,
                    r.battles
                )}% WR\n`;
            });

            return { content: [{ type: "text", text: report.trim() }] };
        }
    );
}

// The member list on /wotx/clans/info/ may be an array of member objects,
// a dict keyed by account_id, or just a list of IDs — normalize all three.
function extractClanMembers(details: ClanDetails): ClanMemberInfo[] {
    const m = details.members;
    if (Array.isArray(m)) {
        return m.filter((member) => member && member.account_id);
    }
    if (m && typeof m === "object") {
        return Object.entries(m)
            .map(([id, member]) => ({
                ...member,
                account_id: member?.account_id ?? parseInt(id),
            }))
            .filter((member) => Number.isFinite(member.account_id));
    }
    if (Array.isArray(details.members_ids)) {
        return details.members_ids
            .filter((id) => Number.isFinite(id))
            .map((id) => ({ account_id: id }));
    }
    return [];
}
