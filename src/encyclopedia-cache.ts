// Cached lookups against the Tankopedia so player-facing output can show
// real tank and achievement names instead of raw IDs. The underlying HTTP
// responses are TTL-cached in api.ts, so these are cheap after the first call.

import { makeWargamingRequest, Platform } from "./api.js";
import type { VehicleInfo, WargamingResponse } from "./types.js";

// Match a vehicle by full name, short name, or name ignoring dashes/spaces
// (so "IS7", "IS 7", and "IS-7" all match "IS-7")
export function matchesVehicleName(
    vehicle: { name: string; short_name?: string },
    searchTerm: string
): boolean {
    const term = searchTerm.toLowerCase();
    const name = vehicle.name.toLowerCase();
    const shortName = vehicle.short_name?.toLowerCase() || "";
    return (
        name.includes(term) ||
        shortName.includes(term) ||
        name.replace(/[-\s]/g, "").includes(term.replace(/[-\s]/g, ""))
    );
}

export interface VehicleMapResult {
    vehicles: Map<number, VehicleInfo>;
    error?: string;
}

// Load the full vehicle database keyed by tank_id
export async function getVehicleMap(
    platform: Platform
): Promise<VehicleMapResult> {
    const response = await makeWargamingRequest<
        WargamingResponse<{ [key: string]: VehicleInfo }>
    >(platform, "/wotx/encyclopedia/vehicles/", {});

    const vehicles = new Map<number, VehicleInfo>();
    if (!response || response.status === "error") {
        return {
            vehicles,
            error: response?.error?.message || "Unknown error",
        };
    }

    for (const [tankId, vehicle] of Object.entries(response.data || {})) {
        vehicles.set(parseInt(tankId), {
            ...vehicle,
            tank_id: parseInt(tankId),
        });
    }
    return { vehicles };
}

// "IS-7 (ID: 7169)" when the tank is known, "Tank ID 7169" otherwise
export function tankLabel(
    vehicles: Map<number, VehicleInfo>,
    tankId: number
): string {
    const vehicle = vehicles.get(tankId);
    return vehicle ? `${vehicle.name} (ID: ${tankId})` : `Tank ID ${tankId}`;
}

// Find all vehicles fuzzily matching a name
export async function findTanksByName(
    platform: Platform,
    name: string
): Promise<VehicleInfo[]> {
    const { vehicles } = await getVehicleMap(platform);
    return [...vehicles.values()].filter((vehicle) =>
        matchesVehicleName(vehicle, name)
    );
}

// Map of achievement ID -> localized display name
export async function getAchievementNames(
    platform: Platform
): Promise<Map<string, string>> {
    const response = await makeWargamingRequest<
        WargamingResponse<{ [key: string]: { name: string } }>
    >(platform, "/wotx/encyclopedia/achievements/", {});

    const names = new Map<string, string>();
    if (response?.status === "ok") {
        for (const [id, achievement] of Object.entries(response.data || {})) {
            if (achievement?.name) {
                names.set(id, achievement.name);
            }
        }
    }
    return names;
}

export function achievementLabel(
    names: Map<string, string>,
    achievementId: string
): string {
    return names.get(achievementId) || achievementId;
}
