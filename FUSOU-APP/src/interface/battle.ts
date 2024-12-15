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
    // air_base_force_jet_assault: Option<number[]>,
    // force_jet_assault: Option<number[]>,
    // AirBaseCombat: Option<AirBaseCombat>,
    // Mobile TaskForceFriendlyAirCombat: Option<MobileTaskForceFriendlyAirCombat>
    // opening_kouku: Option<Kouku>,
    // support_attack: Option<SupportAttack>,
    opening_taisen: OpeningTaisen,
    opening_raigeki: OpeningRaigeki,
    hougeki: Hougeki[],
    closing_raigeki: EndingRaigeki,
    // friendly_fleet_attack: Option<FriendlyFleetAttack>,
    // midnight_hougeki: Option<Vec<Option<Hougeki>>,
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