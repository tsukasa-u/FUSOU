export interface Battles {
    cells: number[],
    battles: {[key: number]: Battle},
}

export interface Battle {
    cell_id: number,
    deck_id: number | null,
    formation: number[] | null,
    enemy_ship_id: number[],
    e_params: number[][] | null,
    e_slot: number[][] | null,
    e_hp_max: number[] | null,
    total_damages_friends: number[] | null,
    total_damages_enemies: number[] | null,
    reconnaissance: number[] | null,
    forward_observe: number[] | null,
    escape_idx: number[] | null,
    smoke_type: number | null,
    // air_base_assault: AirBaseAssult,
    // carrier_base_assault: CarrierBaseAssault,
    air_base_air_attacks: AirBaseAirAttacks,
    // friendly_task_force_attack: FriendlyTaskForceAttack | null,
    opening_air_attack: AirAttack,
    support_attack: SupportAttack | null,
    opening_taisen: OpeningTaisen,
    opening_raigeki: OpeningRaigeki,
    hougeki: Hougeki[],
    closing_raigeki: ClosingRaigeki,
    // friendly_fleet_attack: Option<FriendlyFleetAttack>,
    midnight_flare_pos: number[] | null,
    midngiht_touchplane: number[] | null,
    midnight_hougeki: MidnightHougeki | null,
}

export interface SupportAttack {
    support_hourai: SupportHourai | null;
    // support_airatack: SupportAirAttack | null;,
}

export interface SupportHourai {
    cl_list: number[],
    damage: number[],
    deck_id: number,
    ship_id: number[],
    protect_flag: boolean[],
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
    total_damages_friends: [],
    total_damages_enemies: [],
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
        },
    },
    support_attack: {
        support_hourai: {
            cl_list: [],
            damage: [],
            deck_id: 0,
            ship_id: [],
            protect_flag: [],
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
    },
};