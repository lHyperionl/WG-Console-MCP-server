// Session / progress tracking tools.
//
// The Wargaming API only returns lifetime totals, so these tools maintain
// local snapshots (see ../snapshots.ts) and diff them to answer questions
// like "how did I do tonight?" or "how has my win rate moved this week?".

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeWargamingRequest, Platform } from "../api.js";
import { formatNumber, percent } from "../format.js";
import { getVehicleMap, tankLabel } from "../encyclopedia-cache.js";
import { resolvePlayerByNickname } from "../player-lookup.js";
import {
    loadSnapshotFile,
    pickBaseline,
    saveSnapshot,
    snapshotDir,
    type PlayerSnapshot,
    type SnapshotTotals,
    type TankSnapshot,
} from "../snapshots.js";
import type {
    PlayerStats,
    PlayerVehicleStats,
    WargamingResponse,
} from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Fetch the player's current lifetime totals + per-tank counters and
// package them as a snapshot ready for storage or diffing.
async function fetchCurrentSnapshot(
    platform: Platform,
    accountId: number
): Promise<{ snapshot?: PlayerSnapshot; error?: string }> {
    const [statsRes, tanksRes] = await Promise.all([
        makeWargamingRequest<WargamingResponse<{ [key: string]: PlayerStats }>>(
            platform,
            "/wotx/account/info/",
            { account_id: accountId }
        ),
        makeWargamingRequest<
            WargamingResponse<{ [key: string]: PlayerVehicleStats[] }>
        >(platform, "/wotx/tanks/stats/", { account_id: accountId }),
    ]);

    const stats = statsRes?.data?.[accountId.toString()]?.statistics?.all;
    if (!stats) {
        return {
            error: `Failed to fetch statistics for account ${accountId}: ${
                statsRes?.error?.message || "no data returned"
            }`,
        };
    }

    const totals: SnapshotTotals = {
        battles: stats.battles || 0,
        wins: stats.wins || 0,
        damage_dealt: stats.damage_dealt || 0,
        damage_received: stats.damage_received || 0,
        frags: stats.frags || 0,
        spots: stats.spotted || 0,
        survived_battles: stats.survived_battles,
        xp: stats.xp,
    };

    const tanks: Record<string, TankSnapshot> = {};
    for (const tank of tanksRes?.data?.[accountId.toString()] || []) {
        const s = tank.all;
        tanks[tank.tank_id.toString()] = {
            battles: s.battles || 0,
            wins: s.wins || 0,
            damage_dealt: s.damage_dealt || 0,
            frags: s.frags || 0,
        };
    }

    return { snapshot: { taken_at: Date.now(), totals, tanks } };
}

const deltaOf = (
    current: number | undefined,
    baseline: number | undefined
): number => (current ?? 0) - (baseline ?? 0);

function formatWhen(ms: number): string {
    const date = new Date(ms);
    const ageDays = (Date.now() - ms) / DAY_MS;
    const age =
        ageDays < 1
            ? `${Math.max(1, Math.round(ageDays * 24))}h ago`
            : `${ageDays.toFixed(1)}d ago`;
    return `${date.toLocaleString()} (${age})`;
}

export function registerProgressTools(server: McpServer): void {
    // Tool: Record a baseline snapshot
    server.tool(
        "snapshot-player",
        "Record a local snapshot of a player's current lifetime statistics (overall + per-tank). Snapshots power get-player-progress: take one before a play session, then compare afterwards. Stored on this machine only.",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            nickname: z.string().describe("Player nickname"),
        },
        async ({ platform, nickname }) => {
            const { player, note, error } = await resolvePlayerByNickname(
                platform,
                nickname
            );
            if (error || !player) {
                return { content: [{ type: "text", text: `❌ ${error}` }] };
            }

            const { snapshot, error: fetchError } = await fetchCurrentSnapshot(
                platform,
                player.account_id
            );
            if (fetchError || !snapshot) {
                return {
                    content: [{ type: "text", text: `❌ ${fetchError}` }],
                };
            }

            const { file, saved } = await saveSnapshot(
                platform,
                player.account_id,
                player.nickname,
                snapshot
            );

            let text = `**Snapshot for ${player.nickname}** (${platform.toUpperCase()})\n`;
            if (note) text += `*${note}*\n`;
            text += `\n• Lifetime battles: ${formatNumber(
                snapshot.totals.battles
            )}\n`;
            text += `• Lifetime win rate: ${percent(
                snapshot.totals.wins,
                snapshot.totals.battles
            )}%\n`;
            text += saved
                ? `\n✅ Snapshot saved (${file.snapshots.length} stored for this player). Play some battles, then call get-player-progress to see session results.`
                : `\n✅ Nothing new to record — the latest stored snapshot already has ${formatNumber(
                      snapshot.totals.battles
                  )} battles, so it stays the baseline.`;

            return { content: [{ type: "text", text }] };
        }
    );

    // Tool: Diff current stats against a stored snapshot
    server.tool(
        "get-player-progress",
        "Show a player's performance since a stored snapshot: battles played, win rate, average damage, and per-tank breakdown over the interval (not lifetime). By default compares against the most recent snapshot; pass since_days to compare against the snapshot closest to N days ago. Automatically stores the current state as a new snapshot afterwards.",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            nickname: z.string().describe("Player nickname"),
            since_days: z
                .number()
                .positive()
                .optional()
                .describe(
                    "Compare against the snapshot taken closest to this many days ago (default: the most recent snapshot)"
                ),
        },
        async ({ platform, nickname, since_days }) => {
            const { player, note, error } = await resolvePlayerByNickname(
                platform,
                nickname
            );
            if (error || !player) {
                return { content: [{ type: "text", text: `❌ ${error}` }] };
            }

            const [{ snapshot: current, error: fetchError }, stored] =
                await Promise.all([
                    fetchCurrentSnapshot(platform, player.account_id),
                    loadSnapshotFile(platform, player.account_id),
                ]);
            if (fetchError || !current) {
                return {
                    content: [{ type: "text", text: `❌ ${fetchError}` }],
                };
            }

            const baseline = pickBaseline(
                stored?.snapshots ?? [],
                since_days !== undefined
                    ? Date.now() - since_days * DAY_MS
                    : undefined
            );

            // First contact with this player: record the baseline and explain
            if (!baseline) {
                await saveSnapshot(
                    platform,
                    player.account_id,
                    player.nickname,
                    current
                );
                return {
                    content: [
                        {
                            type: "text",
                            text: `No snapshots stored yet for **${player.nickname}** — recorded the first one now (${formatNumber(
                                current.totals.battles
                            )} lifetime battles). Play some battles, then call get-player-progress again to see session results.`,
                        },
                    ],
                };
            }

            const b = deltaOf(current.totals.battles, baseline.totals.battles);
            let text = `**Progress Report: ${player.nickname}** (${platform.toUpperCase()})\n`;
            if (note) text += `*${note}*\n`;
            text += `Baseline: ${formatWhen(baseline.taken_at)}\n\n`;

            if (b <= 0) {
                text += `No battles played since the baseline (lifetime battles unchanged at ${formatNumber(
                    current.totals.battles
                )}).`;
                return { content: [{ type: "text", text }] };
            }

            const wins = deltaOf(current.totals.wins, baseline.totals.wins);
            const dmg = deltaOf(
                current.totals.damage_dealt,
                baseline.totals.damage_dealt
            );
            const dmgReceived = deltaOf(
                current.totals.damage_received,
                baseline.totals.damage_received
            );
            const frags = deltaOf(current.totals.frags, baseline.totals.frags);
            const spots = deltaOf(current.totals.spots, baseline.totals.spots);
            const survived = deltaOf(
                current.totals.survived_battles,
                baseline.totals.survived_battles
            );
            const xp = deltaOf(current.totals.xp, baseline.totals.xp);

            text += `**Since then (${formatNumber(b)} battles):**\n`;
            text += `• Win rate: ${percent(wins, b)}% (${wins}W / ${
                b - wins
            }L·D)\n`;
            text += `• Average damage: ${formatNumber(Math.round(dmg / b))}\n`;
            if (dmgReceived > 0) {
                text += `• Damage ratio: ${(dmg / dmgReceived).toFixed(2)}\n`;
            }
            text += `• Frags per battle: ${(frags / b).toFixed(2)}\n`;
            text += `• Spots per battle: ${(spots / b).toFixed(2)}\n`;
            if (
                current.totals.survived_battles !== undefined &&
                baseline.totals.survived_battles !== undefined
            ) {
                text += `• Survival rate: ${percent(survived, b)}%\n`;
            }
            if (current.totals.xp !== undefined && xp > 0) {
                text += `• Average XP: ${formatNumber(Math.round(xp / b))}\n`;
            }

            // Lifetime win rate movement
            const wrBefore = percent(
                baseline.totals.wins,
                baseline.totals.battles
            );
            const wrNow = percent(current.totals.wins, current.totals.battles);
            text += `• Lifetime win rate: ${wrBefore}% → ${wrNow}%\n`;

            // Per-tank breakdown over the interval
            const tankDeltas = Object.entries(current.tanks)
                .map(([tankId, now]) => {
                    const before = baseline.tanks[tankId];
                    return {
                        tankId: parseInt(tankId),
                        battles: deltaOf(now.battles, before?.battles),
                        wins: deltaOf(now.wins, before?.wins),
                        damage: deltaOf(now.damage_dealt, before?.damage_dealt),
                        frags: deltaOf(now.frags, before?.frags),
                    };
                })
                .filter((t) => t.battles > 0)
                .sort((a, b2) => b2.battles - a.battles);

            if (tankDeltas.length > 0) {
                const { vehicles } = await getVehicleMap(platform);
                text += `\n**Tanks played (${tankDeltas.length}):**\n`;
                tankDeltas.slice(0, 10).forEach((t, i) => {
                    text += `${i + 1}. ${tankLabel(vehicles, t.tankId)}: ${
                        t.battles
                    } battles, ${percent(t.wins, t.battles, 1)}% WR, ${formatNumber(
                        Math.round(t.damage / t.battles)
                    )} avg dmg, ${(t.frags / t.battles).toFixed(1)} frags/battle\n`;
                });
                if (tankDeltas.length > 10) {
                    text += `*…and ${tankDeltas.length - 10} more*\n`;
                }
            }

            const { saved } = await saveSnapshot(
                platform,
                player.account_id,
                player.nickname,
                current
            );
            if (saved) {
                text += `\n*Current state saved as a new snapshot — the next progress report measures from now.*`;
            }

            return { content: [{ type: "text", text: text.trim() }] };
        }
    );

    // Tool: List stored snapshots
    server.tool(
        "list-player-snapshots",
        "List the locally stored stat snapshots for a player (when each was taken and the lifetime battle count / win rate at that point)",
        {
            platform: z
                .enum(["xbox", "ps4"])
                .describe("Gaming platform (xbox or ps4)"),
            nickname: z.string().describe("Player nickname"),
        },
        async ({ platform, nickname }) => {
            const { player, error } = await resolvePlayerByNickname(
                platform,
                nickname
            );
            if (error || !player) {
                return { content: [{ type: "text", text: `❌ ${error}` }] };
            }

            const file = await loadSnapshotFile(platform, player.account_id);
            if (!file || file.snapshots.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No snapshots stored for **${player.nickname}** on ${platform.toUpperCase()} (storage: ${snapshotDir()}). Use snapshot-player or get-player-progress to record one.`,
                        },
                    ],
                };
            }

            let text = `**Stored snapshots for ${player.nickname}** (${platform.toUpperCase()}) — ${
                file.snapshots.length
            } total\n\n`;
            text += `| # | Taken | Lifetime battles | Lifetime WR |\n`;
            text += `| --- | --- | --- | --- |\n`;
            // Newest first for readability
            [...file.snapshots].reverse().forEach((s, i) => {
                text += `| ${file.snapshots.length - i} | ${formatWhen(
                    s.taken_at
                )} | ${formatNumber(s.totals.battles)} | ${percent(
                    s.totals.wins,
                    s.totals.battles
                )}% |\n`;
            });
            text += `\n*Stored in ${snapshotDir()}*`;

            return { content: [{ type: "text", text }] };
        }
    );
}
