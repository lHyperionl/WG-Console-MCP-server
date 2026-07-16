// Shared type definitions for Wargaming API responses

export interface WargamingResponse<T> {
    status: "ok" | "error";
    data: T;
    error?: {
        field: string;
        message: string;
        code: number;
    };
}

export interface PlayerInfo {
    nickname: string;
    account_id: number;
}

export interface PlayerStats {
    account_id: number;
    nickname?: string;
    last_battle_time?: number;
    created_at?: number;
    statistics: {
        all: {
            battles: number;
            wins: number;
            losses: number;
            draws: number;
            damage_dealt: number;
            damage_received: number;
            frags: number;
            spots: number;
            avg_damage: number;
            avg_xp: number;
            win_ratio: number;
            xp?: number;
            survived_battles?: number;
        };
    };
}

export interface VehicleInfo {
    tank_id: number;
    name: string;
    short_name: string;
    nation: string;
    type: string;
    tier: number;
    is_premium?: boolean;
}

export interface ClanInfo {
    clan_id: number;
    name: string;
    tag: string;
    members_count: number;
    created_at: number;
    description: string;
}

export interface ClanMemberInfo {
    account_id: number;
    account_name?: string;
    role?: string;
    role_i18n?: string;
    joined_at?: number;
}

// /wotx/clans/info/ — the member list shape varies across Wargaming APIs
// (array, dict keyed by account_id, or a bare id list), so model all three.
export interface ClanDetails extends ClanInfo {
    members?: ClanMemberInfo[] | Record<string, ClanMemberInfo>;
    members_ids?: number[];
    leader_name?: string;
    motto?: string;
}

export interface PlayerVehicleStats {
    tank_id: number;
    statistics: {
        all: {
            battles: number;
            wins: number;
            losses: number;
            draws: number;
            damage_dealt: number;
            damage_received: number;
            frags: number;
            spots: number;
            avg_damage: number;
            avg_xp: number;
            win_ratio: number;
            max_frags: number;
            max_xp: number;
            max_damage: number;
            mark_of_mastery: number;
        };
    };
}

export interface VehicleModule {
    module_id: number;
    name: string;
    type: string;
    tier: number;
    nation: string;
    image: string;
    price_gold: number;
    price_credit: number;
}

export interface TankDetails extends VehicleInfo {
    description: string;
    engines: number[];
    guns: number[];
    radios: number[];
    suspensions: number[];
    turrets: number[];
    crew: any[];
    price_gold: number;
    price_credit: number;
    max_health: number;
    weight: number;
    speed_limit: number;
    hull_hp: number;
    hull_weight: number;
    max_ammo: number;
    fire_chance: number;
}

// Full configuration profile returned by /wotx/encyclopedia/vehicleprofile/
export interface VehicleProfile {
    hp: number;
    hull_hp: number;
    hull_weight: number;
    is_default: boolean;
    max_ammo: number;
    max_weight: number;
    profile_id: string;
    speed_backward: number;
    speed_forward: number;
    tank_id: number;
    weight: number;
    ammo?: Array<{
        damage: number[];
        penetration: number[];
        type: string;
        stun?: { duration: any };
    }>;
    armor?: {
        hull?: { front: number; rear: number; sides: number };
        turret?: { front: number; rear: number; sides: number };
    };
    autosiege?: any;
    engine?: {
        fire_chance: number;
        name: string;
        power: number;
        tag: string;
        tier: number;
        weight: number;
    };
    gun?: {
        aim_time: number;
        caliber: number;
        dispersion: number;
        fire_rate: number;
        move_down_arc: number;
        move_up_arc: number;
        name: string;
        reload_time: number;
        tag: string;
        tier: number;
        traverse_speed: number;
        weight: number;
    };
    modules?: {
        engine_id: number;
        gun_id: number;
        radio_id: number;
        suspension_id: number;
        turret_id: number;
    };
    multi_turret?: { turrets: number[] };
    multi_weapon?: any;
    radio?: {
        name: string;
        signal_range: number;
        tag: string;
        tier: number;
        weight: number;
    };
    rapid?: any;
    siege?: any;
    suspension?: {
        load_limit: number;
        name: string;
        steering_lock_angle?: number;
        tag: string;
        tier: number;
        traverse_speed: number;
        weight: number;
    };
    turbo?: any;
    turret?: {
        hp: number;
        name: string;
        tag: string;
        tier: number;
        traverse_left_arc: number;
        traverse_right_arc: number;
        traverse_speed: number;
        view_range: number;
        weight: number;
    };
}
