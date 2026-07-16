import dotenv from "dotenv";
import type { WargamingResponse } from "./types.js";

// Load environment variables from .env file (silently)
dotenv.config({ quiet: true });

// Wargaming API configuration — Xbox and PlayStation share one unified endpoint
export const WARGAMING_API_URLS = {
    xbox: "https://api-modernarmor.worldoftanks.com",
    ps4: "https://api-modernarmor.worldoftanks.com",
} as const;

export type Platform = keyof typeof WARGAMING_API_URLS;

// Fail fast with a clear message when the API key is missing
export function requireApiKey(): string {
    const key = process.env.WARGAMING_API_KEY;
    if (!key) {
        console.error(
            "Error: WARGAMING_API_KEY environment variable is required"
        );
        process.exit(1);
    }
    return key;
}

// Hints for the Wargaming API errors users hit most often
const API_ERROR_HINTS: Record<string, string> = {
    INVALID_IP_ADDRESS:
        "your API key is a server-type key locked to specific IPs — add your current IP at https://developers.wargaming.net/applications/ or use a mobile-type key",
    INVALID_APPLICATION_ID:
        "the WARGAMING_API_KEY is invalid — check your key at https://developers.wargaming.net/applications/",
    REQUEST_LIMIT_EXCEEDED:
        "Wargaming API rate limit reached (10 requests/second) — retry in a moment",
};

// ---- Client-side rate limiting ----
// The Wargaming API allows 10 requests per second; throttle locally so
// bursts of tool calls (e.g. player reports) never trip the server limit.
const MAX_REQUESTS_PER_SECOND = 10;
const requestTimestamps: number[] = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRateLimitSlot(): Promise<void> {
    for (;;) {
        const now = Date.now();
        while (
            requestTimestamps.length > 0 &&
            now - requestTimestamps[0] >= 1000
        ) {
            requestTimestamps.shift();
        }
        if (requestTimestamps.length < MAX_REQUESTS_PER_SECOND) {
            requestTimestamps.push(now);
            return;
        }
        await sleep(1000 - (now - requestTimestamps[0]) + 5);
    }
}

// ---- Response caching ----
// Encyclopedia data only changes on game patches, so cache it for an hour.
// This makes name-based tank lookups (which load the full vehicle database)
// effectively free after the first call.
const CACHE_TTL_MS = 60 * 60 * 1000;
const responseCache = new Map<string, { expiresAt: number; data: unknown }>();

function isCacheable(endpoint: string): boolean {
    return endpoint.startsWith("/wotx/encyclopedia/");
}

function cacheKey(
    endpoint: string,
    params: Record<string, string | number>
): string {
    return `${endpoint}?${JSON.stringify(Object.entries(params).sort())}`;
}

// ---- Request helper ----
const MAX_RETRIES = 2;

export async function makeWargamingRequest<T>(
    platform: Platform,
    endpoint: string,
    params: Record<string, string | number> = {}
): Promise<T | null> {
    const key = cacheKey(endpoint, params);
    if (isCacheable(endpoint)) {
        const cached = responseCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data as T;
        }
    }

    const url = new URL(endpoint, WARGAMING_API_URLS[platform]);
    url.searchParams.append("application_id", requireApiKey());
    Object.entries(params).forEach(([paramKey, value]) => {
        url.searchParams.append(paramKey, String(value));
    });

    try {
        for (let attempt = 0; ; attempt++) {
            await waitForRateLimitSlot();
            const response = await fetch(url.toString());

            if (!response.ok) {
                // Transient server errors and 429s are worth retrying
                if (
                    (response.status === 429 || response.status >= 500) &&
                    attempt < MAX_RETRIES
                ) {
                    await sleep(300 * (attempt + 1));
                    continue;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = (await response.json()) as T;
            const maybeError = data as WargamingResponse<unknown>;

            if (maybeError?.status === "error" && maybeError.error?.message) {
                if (
                    maybeError.error.message === "REQUEST_LIMIT_EXCEEDED" &&
                    attempt < MAX_RETRIES
                ) {
                    await sleep(500 * (attempt + 1));
                    continue;
                }
                // Attach an actionable hint to well-known API errors
                const hint = API_ERROR_HINTS[maybeError.error.message];
                if (hint) {
                    maybeError.error.message += ` (${hint})`;
                }
            } else if (isCacheable(endpoint) && maybeError?.status === "ok") {
                responseCache.set(key, {
                    expiresAt: Date.now() + CACHE_TTL_MS,
                    data,
                });
            }

            return data;
        }
    } catch (error) {
        console.error("Error making Wargaming API request:", error);
        return null;
    }
}
