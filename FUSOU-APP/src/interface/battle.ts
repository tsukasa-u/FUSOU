export interface Battles {
    cells: number[],
    battles: {[key: number]: Battle},
}

export interface EnumAirBaseAssult {AirBaseAssult: any};
export interface EnumCarrierBaseAssault {CarrierBaseAssault: any};
export interface EnumAirBaseAirAttack {AirBaseAirAttack: any};
export interface EnumOpeningAirAttack {OpeningAirAttack: any};
export interface EnumSupportAttack {SupportAttack: any};
export interface EnumOpeningTaisen {OpeningTaisen: any};
export interface EnumOpeningRaigeki {OpeningRaigeki: any};
export interface EnumHougeki {Hougeki: number};
export interface EnumClosingRaigeki {ClosingRaigeki: any};
export interface EnumFriendlyForceAttack {FriendlyForceAttack: any};
export interface EnumMidnightHougeki {MidnightHougeki: any};

type EnumBattleType = EnumAirBaseAssult | EnumCarrierBaseAssault | EnumAirBaseAirAttack | EnumOpeningAirAttack | EnumSupportAttack | EnumOpeningTaisen | EnumOpeningRaigeki | EnumHougeki | EnumClosingRaigeki | EnumFriendlyForceAttack | EnumMidnightHougeki;

export function implementsEnumAirBaseAssult(arg: EnumBattleType): arg is EnumAirBaseAssult {
    return arg !== null && typeof arg === "object" && "AirBaseAssult" in arg;
}

export function implementsEnumCarrierBaseAssault(arg: EnumBattleType): arg is EnumCarrierBaseAssault {
    return arg !== null && typeof arg === "object" && "CarrierBaseAssault" in arg;
}

export function implementsEnumAirBaseAirAttack(arg: EnumBattleType): arg is EnumAirBaseAirAttack {
    return arg !== null && typeof arg === "object" && "AirBaseAirAttack" in arg;
}

export function implementsEnumOpeningAirAttack(arg: EnumBattleType): arg is EnumOpeningAirAttack {
    return arg !== null && typeof arg === "object" && "OpeningAirAttack" in arg;
}

export function implementsEnumSupportAttack(arg: EnumBattleType): arg is EnumSupportAttack {
    return arg !== null && typeof arg === "object" && "SupportAttack" in arg;
}

export function implementsEnumOpeningTaisen(arg: EnumBattleType): arg is EnumOpeningTaisen {
    return arg !== null && typeof arg === "object" && "OpeningTaisen" in arg;
}

export function implementsEnumOpeningRaigeki(arg: EnumBattleType): arg is EnumOpeningRaigeki {
    return arg !== null && typeof arg === "object" && "OpeningRaigeki" in arg;
}

export function implementsEnumHougeki(arg: any): arg is EnumHougeki {
    return arg !== null && typeof arg === "object" && "Hougeki" in arg;
}

export function implementsEnumClosingRaigeki(arg: EnumBattleType): arg is EnumClosingRaigeki {
    return arg !== null && typeof arg === "object" && "ClosingRaigeki" in arg;
}

export function implementsEnumFriendlyForceAttack(arg: EnumBattleType): arg is EnumFriendlyForceAttack {
    return arg !== null && typeof arg === "object" && "FriendlyForceAttack" in arg;
}

export function implementsEnumMidnightHougeki(arg: EnumBattleType): arg is EnumMidnightHougeki {
    return arg !== null && typeof arg === "object" && "MidnightHougeki" in arg;
}


export interface Battle {
    battle_order: EnumBattleType[] | null,
    
    cell_id: number,
    deck_id: number | null,
    formation: number[] | null,
    enemy_ship_id: number[],
    e_params: number[][] | null,
    e_slot: number[][] | null,
    e_hp_max: number[] | null,
    f_total_damages: number[] | null,
    e_total_damages: number[] | null,
    friend_total_damages: number[] | null,
    midnight_f_total_damages: number[] | null,
    midnight_e_total_damages: number[] | null,
    reconnaissance: number[] | null,
    forward_observe: number[] | null,
    escape_idx: number[] | null,
    smoke_type: number | null,
    air_base_assault: AirBaseAssult | null,
    carrier_base_assault: CarrierBaseAssault | null,
    air_base_air_attacks: AirBaseAirAttacks,
    // friendly_task_force_attack: FriendlyTaskForceAttack | null,
    opening_air_attack: AirAttack,
    support_attack: SupportAttack | null,
    opening_taisen: OpeningTaisen,
    opening_raigeki: OpeningRaigeki,
    hougeki: Hougeki[],
    closing_raigeki: ClosingRaigeki,
    friendly_force_attack: FriendlyForceAttack | null,
    midnight_flare_pos: number[] | null,
    midngiht_touchplane: number[] | null,
    midnight_hougeki: MidnightHougeki | null,
    f_nowhps: number[] | null,
    e_nowhps: number[] | null,
    midngiht_f_nowhps: number[] | null,
    midngiht_e_nowhps: number[] | null,
}

export interface FriendlyForceAttack {
    fleet_info: FriendlyForceInfo,
    support_hourai: FriendlySupportHourai | null,
    // support_airatack: Option<FriendlySupportAiratack>,
}

export interface FriendlySupportHourai {
    flare_pos: number[],
    hougeki: MidnightHougeki,
}

export interface FriendlyForceInfo {
    ship_id: number[],
    params: number[][],
    ship_lv: number[],
    now_hps: number[],
    slot: number[][],
}

export interface AirBaseAssult {
    squadron_plane: number[],
    f_damage: AirDamage,
    e_damage: AirDamage,
}

export interface CarrierBaseAssault {
    f_damage: AirDamage,
    e_damage: AirDamage,
}

export interface SupportAttack {
    support_hourai: SupportHourai | null,
    support_airatack: SupportAiratack | null,
}

export interface SupportAiratack {
    deck_id: number,
    ship_id: number[],
    f_damage: AirDamage,
    e_damage: AirDamage,
}

export interface SupportHourai {
    cl_list: number[],
    damage: number[],
    deck_id: number,
    ship_id: number[],
    protect_flag: boolean[],
    now_hps: number[],
}


export interface MidnightHougeki {
    at_list: number[] | null,
    df_list: number[][] | null,
    cl_list: number[][] | null,
    damage: number[][] | null,
    at_eflag: number[] | null,
    si_list: (number | null)[][] | null,
    sp_list: number[] | null,
    protect_flag: boolean[][] | null,
    f_now_hps: number[][],
    e_now_hps: number[][],
}

export interface AirBaseAirAttacks {
    attacks: AirBaseAirAttack[],
}

export interface AirBaseAirAttack {
    stage_flag: number[],
    squadron_plane: (number | null)[] | null,
    base_id: number,
    f_damage: AirDamage,
    e_damage: AirDamage,
}

export interface AirAttack {
    air_superiority: number | null,
    air_fire: AirFire | null,
    f_damage: AirDamage,
    e_damage: AirDamage,
}

export interface AirFire {
    use_item: number[],
    idx: number,
}

export interface AirDamage {
    plane_from: number[] | null,
    touch_plane: number | null,
    loss_plane1: number,
    loss_plane2: number,
    damages: number[] | null,
    cl: number[] | null,
    sp: (number[] | null)[] | null,
    rai_flag: (number | null)[] | null,
    bak_flag: (number | null)[] | null,
    protect_flag: boolean[] | null,
    now_hps: number[],
}

export interface OpeningTaisen {
    at_list: number[],
    at_type: number[],
    df_list: number[][],
    cl_list: number[][],
    damage: number[][],
    at_eflag: number[],
    si_list: (number | null)[][],
    protect_flag: boolean[][],
    f_now_hps: number[][],
    e_now_hps: number[][],
}

export interface OpeningRaigeki {
    fdam: number[],
    edam: number[],
    // fydam_list_items: number[][],
    // eydam_list_items: number[][],
    frai_list_items: number[][],
    erai_list_items: number[][],
    // fcl_list_items: number[][],
    // ecl_list_items: number[][],
    fcl_list: number[],
    ecl_list: number[],
    f_protect_flag: boolean[],
    e_protect_flag: boolean[],
    f_now_hps: number[],
    e_now_hps: number[],
}

export interface Hougeki {
    at_list: number[],
    at_type: number[],
    df_list: number[][],
    cl_list: number[][],
    damage: number[][],
    at_eflag: number[],
    si_list: (number | null)[][],
    protect_flag: boolean[][],
    f_now_hps: number[][],
    e_now_hps: number[][],
}

export interface ClosingRaigeki {
    fdam: number[],
    edam: number[],
    // fydam: number[],
    // eydam: number[],
    frai: number[],
    erai: number[],
    fcl: number[],
    ecl: number[],
    f_protect_flag: boolean[],
    e_protect_flag: boolean[],
    f_now_hps: number[],
    e_now_hps: number[],
}

export var global_battles: Battles = {
    cells: [],
    battles: {},
};

export var global_battle: Battle = {
    cell_id: 0,
    deck_id: 0,
    formation: [],
    enemy_ship_id: [],
    e_params: [],
    e_slot: [],
    e_hp_max: [],
    reconnaissance: [],
    forward_observe: [],
    escape_idx: [],
    smoke_type: null,
    air_base_air_attacks: {
        attacks: [],
    },
    opening_air_attack: {
        air_superiority: 0,
        air_fire: {
            use_item: [],
            idx: -1,
        },
        f_damage: {
            plane_from: [],
            touch_plane: 0,
            loss_plane1: 0,
            loss_plane2: 0,
            damages: [],
            cl: [],
            sp: [],
            rai_flag: [],
            bak_flag: [],
            protect_flag: [],
            now_hps: [],
        },
        e_damage: {
            plane_from: [],
            touch_plane: 0,
            loss_plane1: 0,
            loss_plane2: 0,
            damages: [],
            cl: [],
            sp: [],
            rai_flag: [],
            bak_flag: [],
            protect_flag: [],
            now_hps: [],
        },
    },
    support_attack: {
        support_hourai: {
            cl_list: [],
            damage: [],
            deck_id: 0,
            ship_id: [],
            protect_flag: [],
            now_hps: [],
        },
        support_airatack: {
            deck_id: 0,
            ship_id: [],
            f_damage: {
                plane_from: [],
                touch_plane: 0,
                loss_plane1: 0,
                loss_plane2: 0,
                damages: [],
                cl: [],
                sp: [],
                rai_flag: [],
                bak_flag: [],
                protect_flag: [],
                now_hps: [],
            },
            e_damage: {
                plane_from: [],
                touch_plane: 0,
                loss_plane1: 0,
                loss_plane2: 0,
                damages: [],
                cl: [],
                sp: [],
                rai_flag: [],
                bak_flag: [],
                protect_flag: [],
                now_hps: [],
            },
        },
    },
    opening_taisen: {
        at_list: [],
        at_type: [],
        df_list: [],
        cl_list: [],
        damage: [],
        at_eflag: [],
        si_list: [],
        protect_flag: [],
        f_now_hps: [],
        e_now_hps: []
    },
    opening_raigeki: {
        fdam: [],
        edam: [],
        // fydam_list_items: [[]],
        // eydam_list_items: [[]],
        frai_list_items: [[]],
        erai_list_items: [[]],
        // fcl_list_items: [[]],
        // ecl_list_items: [[]],
        fcl_list: [],
        ecl_list: [],
        f_protect_flag: [],
        e_protect_flag: [],
        f_now_hps: [],
        e_now_hps: [],
    },
    hougeki: [],
    closing_raigeki: {
        fdam: [],
        edam: [],
        // fydam: [],
        // eydam: [],
        frai: [],
        erai: [],
        fcl: [],
        ecl: [],
        f_protect_flag: [],
        e_protect_flag: [],
        f_now_hps: [],
        e_now_hps: []
    },
    midngiht_touchplane: [],
    midnight_flare_pos: [],
    midnight_hougeki: {
        at_list: [],
        df_list: [[]],
        cl_list: [[]],
        damage: [[]],
        at_eflag: [],
        si_list: [[]],
        sp_list: [],
        protect_flag: [[]],
        f_now_hps: [],
        e_now_hps: []
    },
    air_base_assault: null,
    carrier_base_assault: null,
    friendly_force_attack: null,
    f_nowhps: null,
    e_nowhps: null,
    midngiht_f_nowhps: null,
    midngiht_e_nowhps: null,
    f_total_damages: null,
    e_total_damages: null,
    friend_total_damages: null,
    battle_order: null,
    midnight_f_total_damages: null,
    midnight_e_total_damages: null
};