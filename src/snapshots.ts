// Persistent player stat snapshots for session/progress tracking.
//
// The Wargaming API only exposes lifetime totals, so "recent" performance
// ("how did I do tonight / this week?") cannot be queried directly. This
// module stores small local snapshots of a player's lifetime totals and
// per-tank counters; diffing two snapshots reconstructs the performance
// over the interval between them.
//
// Storage: one JSON file per account under
//   $WARGAMING_MCP_DATA_DIR (or ~/.wargaming-mcp-server/snapshots)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Platform } from "./api.js";

export interface SnapshotTotals {
    battles: number;
    wins: number;
    damage_dealt: number;
    damage_received: number;
    frags: number;
    spots: number;
    survived_battles?: number;
    xp?: number;
}

export interface TankSnapshot {
    battles: number;
    wins: number;
    damage_dealt: number;
    frags: number;
}

export interface PlayerSnapshot {
    taken_at: number; // epoch milliseconds
    totals: SnapshotTotals;
    tanks: Record<string, TankSnapshot>; // keyed by tank_id
}

export interface SnapshotFile {
    account_id: number;
    platform: string;
    nickname: string;
    snapshots: PlayerSnapshot[]; // oldest first
}

const MAX_SNAPSHOTS_PER_PLAYER = 200;

export function snapshotDir(): string {
    return (
        process.env.WARGAMING_MCP_DATA_DIR ||
        path.join(homedir(), ".wargaming-mcp-server", "snapshots")
    );
}

function snapshotPath(platform: Platform, accountId: number): string {
    return path.join(snapshotDir(), `${platform}-${accountId}.json`);
}

export async function loadSnapshotFile(
    platform: Platform,
    accountId: number
): Promise<SnapshotFile | null> {
    try {
        const raw = await readFile(snapshotPath(platform, accountId), "utf8");
        const parsed = JSON.parse(raw) as SnapshotFile;
        return Array.isArray(parsed?.snapshots) ? parsed : null;
    } catch {
        return null; // missing or corrupt file — treat as no history
    }
}

// Append a snapshot unless the latest stored one already has the same
// battle count (nothing new happened, so there is nothing worth keeping).
export async function saveSnapshot(
    platform: Platform,
    accountId: number,
    nickname: string,
    snapshot: PlayerSnapshot
): Promise<{ file: SnapshotFile; saved: boolean }> {
    const file = (await loadSnapshotFile(platform, accountId)) ?? {
        account_id: accountId,
        platform,
        nickname,
        snapshots: [],
    };
    file.nickname = nickname;

    const latest = file.snapshots[file.snapshots.length - 1];
    if (latest && latest.totals.battles === snapshot.totals.battles) {
        return { file, saved: false };
    }

    file.snapshots.push(snapshot);
    if (file.snapshots.length > MAX_SNAPSHOTS_PER_PLAYER) {
        file.snapshots.splice(
            0,
            file.snapshots.length - MAX_SNAPSHOTS_PER_PLAYER
        );
    }

    await mkdir(snapshotDir(), { recursive: true });
    await writeFile(
        snapshotPath(platform, accountId),
        JSON.stringify(file),
        "utf8"
    );
    return { file, saved: true };
}

// Pick the baseline to diff against: with a target time, the most recent
// snapshot taken at or before it (falling back to the oldest we have);
// without one, simply the latest stored snapshot.
export function pickBaseline(
    snapshots: PlayerSnapshot[],
    targetMs?: number
): PlayerSnapshot | undefined {
    if (snapshots.length === 0) return undefined;
    if (targetMs === undefined) return snapshots[snapshots.length - 1];
    const atOrBefore = snapshots.filter((s) => s.taken_at <= targetMs);
    return atOrBefore.length > 0
        ? atOrBefore[atOrBefore.length - 1]
        : snapshots[0];
}
