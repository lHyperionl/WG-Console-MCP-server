// Shared nickname -> account resolution used by every tool that accepts a
// player nickname instead of an account ID.

import { makeWargamingRequest, Platform } from "./api.js";
import type { PlayerInfo, WargamingResponse } from "./types.js";

export interface ResolvedPlayer {
    player?: PlayerInfo;
    // Set when the nickname wasn't an exact match, so tools can tell the
    // user which account was picked and what the alternatives were.
    note?: string;
    error?: string;
}

export async function resolvePlayerByNickname(
    platform: Platform,
    nickname: string
): Promise<ResolvedPlayer> {
    const search = await makeWargamingRequest<WargamingResponse<PlayerInfo[]>>(
        platform,
        "/wotx/account/list/",
        { search: nickname, limit: 10 }
    );

    if (!search || search.status === "error") {
        return {
            error: `Failed to search for player "${nickname}": ${
                search?.error?.message || "Unknown error"
            }`,
        };
    }

    const candidates = search.data || [];
    if (candidates.length === 0) {
        return {
            error: `No players found matching "${nickname}" on ${platform.toUpperCase()}`,
        };
    }

    const exact = candidates.find(
        (p) => p.nickname.toLowerCase() === nickname.toLowerCase()
    );
    const player = exact || candidates[0];
    const note =
        !exact && candidates.length > 1
            ? `Closest match for "${nickname}" — other results: ${candidates
                  .filter((p) => p !== player)
                  .slice(0, 3)
                  .map((p) => p.nickname)
                  .join(", ")}`
            : undefined;

    return { player, note };
}
