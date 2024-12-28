export interface Battles {
    cells: number[],
    battles: {[key: number]: Battle},
}

export interface Battle {
    cell_id: number,
    formation: number[],
    enemy_ship_id: number[],
    total_damages_friends: number[],
    total_damages_enemies: number[],
    reconnaissance: number[],
    forward_observe: number[],
    
    // air_base_assault: AirBaseAssult,
    // carrier_base_assault: CarrierBaseAssault,
    air_base_air_attacks: AirBaseAirAttacks,
    opening_air_attack: AirAttack,
    // support_attack: Option<SupportAttack>,
    opening_taisen: OpeningTaisen,
    opening_raigeki: OpeningRaigeki,
    hougeki: Hougeki[],
    closing_raigeki: EndingRaigeki,
    // friendly_fleet_attack: Option<FriendlyFleetAttack>,
    // midnight_hougeki: Option<Vec<Option<Hougeki>>,
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
    use_items: number[],
    ship_id: number,
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
}

export interface OpeningTaisen {
    at_list: number[],
    at_type: number[],
    df_list: number[][],
    cl_list: number[][],
    damage: number[][],
    at_eflag: number[],
    si_list: (number | null)[][],
}

export interface OpeningRaigeki {
    fdam: number[],
    edam: number[],
    fydam_list_items: number[][],
    eydam_list_items: number[][],
    frai_list_items: number[][],
    erai_list_items: number[][],
    fcl_list_items: number[][],
    ecl_list_items: number[][],
}

export interface Hougeki {
    at_list: number[],
    at_type: number[],
    df_list: number[][],
    cl_list: number[][],
    damage: number[][],
    at_eflag: number[],
    si_list: (number | null)[][],
}

export interface EndingRaigeki {
    fdam: number[],
    edam: number[],
    fydam: number[],
    eydam: number[],
    frai: number[],
    erai: number[],
    fcl: number[],
    ecl: number[],
}

export var global_battles: Battles = {
    cells: [],
    battles: {},
};

export var global_battle: Battle = {
    cell_id: 0,
    formation: [],
    enemy_ship_id: [],
    total_damages_friends: [],
    total_damages_enemies: [],
    reconnaissance: [],
    forward_observe: [],
    air_base_air_attacks: {
        attacks: [],
    },
    opening_air_attack: {
        air_superiority: 0,
        air_fire: {
            use_items: [],
            ship_id: -1,
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
    },
    opening_raigeki: {
        fdam: [],
        edam: [],
        fydam_list_items: [[]],
        eydam_list_items: [[]],
        frai_list_items: [[]],
        erai_list_items: [[]],
        fcl_list_items: [[]],
        ecl_list_items: [[]],
    },
    hougeki: [],
    closing_raigeki: {
        fdam: [],
        edam: [],
        fydam: [],
        eydam: [],
        frai: [],
        erai: [],
        fcl: [],
        ecl: [],
    },
};