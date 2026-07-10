use std::collections::HashMap;

use chrono::Local;

use crate::InterfaceWrapper;
use kc_api_dto::common as kcapi_common;
use kc_api_dto::endpoints as kcapi_main;

use super::battle::{
    build_enemy_ship_sprite_capacity, calc_air_damage, calc_sprite_motion_stage_counts,
    count_sprite_fly_from_capacity, SpritePlaneTypeSet,
};

use kc_api_interface::cells::{
    AirBaseAttack, Cell, CellData, Cells, DestructionBattle, EDeckInfo, Eventmap, Happening,
    Itemget, KCS_CELLS_INDEX,
};

impl From<kcapi_main::api_req_map::next::ApiAirBaseAttack> for InterfaceWrapper<AirBaseAttack> {
    fn from(air_base_attack: kcapi_main::api_req_map::next::ApiAirBaseAttack) -> Self {
        // let (f_damage, e_damage) = TupledAirStages(Some(air_base_attack.api_plane_from.clone()), air_base_attack.api_stage1.clone(), air_base_attack.api_stage2.clone(), air_base_attack.api_stage3.clone(), None).into();
        let (f_damage, e_damage) = calc_air_damage(
            Some(air_base_attack.api_plane_from.clone()),
            air_base_attack.api_stage1.clone(),
            air_base_attack.api_stage2.clone(),
            air_base_attack.api_stage3.clone(),
            None,
        );

        Self(AirBaseAttack {
            air_superiority: air_base_attack
                .api_stage1
                .clone()
                .and_then(|stage1| stage1.api_disp_seiku),
            plane_from: air_base_attack.api_plane_from,
            f_damage,
            e_damage,
            stage_flag: air_base_attack.api_stage_flag,
            map_squadron_plane: air_base_attack.api_map_squadron_plane.map(|map_plane| {
                map_plane
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            v.iter().map(|plane| plane.api_mst_id).collect::<Vec<i64>>(),
                        )
                    })
                    .collect::<HashMap<String, Vec<i64>>>()
            }),
            f_sprite_fly_count: None,
            e_sprite_fly_count: None,
            f_sprite_crash_count: None,
            e_sprite_crash_count: None,
            f_sprite_damage_count: None,
            e_sprite_damage_count: None,
            f_sprite_non_normal_count: None,
            e_sprite_non_normal_count: None,
        })
    }
}

fn count_friend_sprite_fly_from_map_squadrons(
    map_squadron_plane: &Option<HashMap<String, Vec<i64>>>,
) -> Option<i64> {
    let counts = map_squadron_plane.as_ref()?;
    let mut sprite_count = 0;
    for count in counts.values().flat_map(|values| values.iter()) {
        if *count > 0 {
            sprite_count += 1;
        }
        if *count > 6 {
            sprite_count += 1;
        }
    }
    Some(sprite_count)
}

fn apply_destruction_sprite_metrics(
    air_base_attack: &mut AirBaseAttack,
    e_slots: Vec<Vec<i64>>,
) {
    let friend_capacity = count_friend_sprite_fly_from_map_squadrons(
        &air_base_attack.map_squadron_plane,
    );
    let enemy_capacity = build_enemy_ship_sprite_capacity(
        Some(e_slots),
        SpritePlaneTypeSet::AirUnit,
    );

    air_base_attack.f_sprite_fly_count = friend_capacity;
    air_base_attack.e_sprite_fly_count = count_sprite_fly_from_capacity(
        enemy_capacity.as_ref(),
        air_base_attack.e_damage.plane_from.as_deref(),
    );

    let (f_crash, f_damage, f_non_normal) = calc_sprite_motion_stage_counts(
        air_base_attack.f_sprite_fly_count,
        air_base_attack.f_damage.loss_plane1,
        air_base_attack.f_damage.total_plane1,
        air_base_attack.f_damage.loss_plane2,
        air_base_attack.f_damage.total_plane2,
    );
    let (e_crash, e_damage, e_non_normal) = calc_sprite_motion_stage_counts(
        air_base_attack.e_sprite_fly_count,
        air_base_attack.e_damage.loss_plane1,
        air_base_attack.e_damage.total_plane1,
        air_base_attack.e_damage.loss_plane2,
        air_base_attack.e_damage.total_plane2,
    );

    air_base_attack.f_sprite_crash_count = f_crash;
    air_base_attack.e_sprite_crash_count = e_crash;
    air_base_attack.f_sprite_damage_count = f_damage;
    air_base_attack.e_sprite_damage_count = e_damage;
    air_base_attack.f_sprite_non_normal_count = f_non_normal;
    air_base_attack.e_sprite_non_normal_count = e_non_normal;
}

impl From<kcapi_common::common_map::ApiEDeckInfo> for InterfaceWrapper<EDeckInfo> {
    fn from(e_deck_info: kcapi_common::common_map::ApiEDeckInfo) -> Self {
        Self(EDeckInfo {
            kind: e_deck_info.api_kind,
            ship_ids: e_deck_info.api_ship_ids,
        })
    }
}

impl From<kcapi_common::common_map::ApiEventmap> for InterfaceWrapper<Eventmap> {
    fn from(eventmap: kcapi_common::common_map::ApiEventmap) -> Self {
        Self(Eventmap {
            max_maphp: eventmap.api_max_maphp,
            now_maphp: eventmap.api_now_maphp,
            dmg: eventmap.api_dmg,
            gauge_type: eventmap.api_gauge_type,
            gauge_num: eventmap.api_gauge_num,
            state: eventmap.api_state,
            selected_rank: eventmap.api_selected_rank,
        })
    }
}

impl From<kcapi_main::api_req_map::next::ApiItemget> for InterfaceWrapper<Itemget> {
    fn from(itemget: kcapi_main::api_req_map::next::ApiItemget) -> Self {
        Self(Itemget {
            usemst: itemget.api_usemst,
            id: itemget.api_id,
            getcount: itemget.api_getcount,
            icon_id: itemget.api_icon_id,
        })
    }
}

impl From<kcapi_main::api_req_map::start::ApiItemget> for InterfaceWrapper<Itemget> {
    fn from(itemget: kcapi_main::api_req_map::start::ApiItemget) -> Self {
        Self(Itemget {
            usemst: itemget.api_usemst,
            id: itemget.api_id,
            getcount: itemget.api_getcount,
            icon_id: itemget.api_icon_id,
        })
    }
}

impl From<kcapi_common::common_map::ApiHappening> for InterfaceWrapper<Happening> {
    fn from(happening: kcapi_common::common_map::ApiHappening) -> Self {
        Self(Happening {
            count: happening.api_count,
            mst_id: happening.api_mst_id,
            dentan: happening.api_dentan,
        })
    }
}

impl From<kcapi_main::api_req_map::next::ApiDestructionBattle>
    for InterfaceWrapper<DestructionBattle>
{
    fn from(destruction_battle: kcapi_main::api_req_map::next::ApiDestructionBattle) -> Self {
        let mut air_base_attack = InterfaceWrapper::<AirBaseAttack>::from(
            destruction_battle.api_air_base_attack,
        )
        .unwrap();
        apply_destruction_sprite_metrics(&mut air_base_attack, destruction_battle.api_e_slot.clone());

        Self(DestructionBattle {
            formation: destruction_battle.api_formation,
            ship_lv: destruction_battle.api_ship_lv,
            ship_ke: destruction_battle.api_ship_ke,
            e_nowhps: destruction_battle.api_e_nowhps,
            e_maxhps: destruction_battle.api_e_maxhps,
            e_slot: destruction_battle.api_e_slot,
            f_nowhps: destruction_battle.api_f_nowhps,
            f_maxhps: destruction_battle.api_f_maxhps,
            air_base_attack,
            lost_kind: destruction_battle.api_lost_kind,
            f_total_damages: None,
            e_total_damages: None,
        })
    }
}

impl From<kcapi_main::api_req_map::next::ApiData> for InterfaceWrapper<Cell> {
    fn from(cells: kcapi_main::api_req_map::next::ApiData) -> Self {
        let enemy_deck_info: Option<Vec<EDeckInfo>> = cells.api_e_deck_info.map(|e_deck_info| {
            e_deck_info
                .into_iter()
                .map(|info| InterfaceWrapper::<EDeckInfo>::from(info).unwrap())
                .collect()
        });

        // let happening: Option<Happening> = cells.api_happening.map(|happening| happening.into());
        let happening: Option<Happening> = cells
            .api_happening
            .map(|happening| InterfaceWrapper::<Happening>::from(happening).unwrap());

        let destruction_battle: Option<DestructionBattle> =
            cells.api_destruction_battle.map(|destruction_battle| {
                let mut destruction_battle =
                    InterfaceWrapper::<DestructionBattle>::from(destruction_battle).unwrap();
                calc_dmg(&mut destruction_battle);
                destruction_battle
            });

        let itemget: Option<Vec<Itemget>> = cells.api_itemget.map(|items| {
            items
                .into_iter()
                .map(|item| InterfaceWrapper::<Itemget>::from(item).unwrap())
                .collect()
        });

        {
            KCS_CELLS_INDEX.lock().unwrap().push(cells.api_no);
        }

        Self(Cell {
            timestamp: Some(Local::now().timestamp()),
            rashin_id: cells.api_rashin_id,
            no: cells.api_no,
            color_no: cells.api_color_no,
            event_id: cells.api_event_id,
            event_kind: cells.api_event_kind,
            next: cells.api_next,
            e_deck_info: enemy_deck_info,
            limit_state: cells.api_limit_state,
            itemget,
            m1: cells.api_m1,
            destruction_battle,
            happening,
        })
    }
}

impl From<kcapi_main::api_req_map::start::ApiCellData> for InterfaceWrapper<CellData> {
    fn from(cell_data: kcapi_main::api_req_map::start::ApiCellData) -> Self {
        Self(CellData {
            id: cell_data.api_id,
            no: cell_data.api_no,
            color_no: cell_data.api_color_no,
            passed: cell_data.api_passed,
            distance: cell_data.api_distance,
        })
    }
}

impl From<kcapi_main::api_req_map::start::ApiData> for InterfaceWrapper<Cell> {
    fn from(cells: kcapi_main::api_req_map::start::ApiData) -> Self {
        let enemy_deck_info: Option<Vec<EDeckInfo>> = cells.api_e_deck_info.map(|e_deck_info| {
            e_deck_info
                .into_iter()
                .map(|info| InterfaceWrapper::<EDeckInfo>::from(info).unwrap())
                .collect()
        });

        let happening: Option<Happening> = cells
            .api_happening
            .map(|happening| InterfaceWrapper::<Happening>::from(happening).unwrap());

        let itemget: Option<Vec<Itemget>> = cells.api_itemget.map(|items| {
            items
                .into_iter()
                .map(|item| InterfaceWrapper::<Itemget>::from(item).unwrap())
                .collect()
        });

        {
            KCS_CELLS_INDEX.lock().unwrap().push(cells.api_no);
        }

        Self(Cell {
            timestamp: Some(Local::now().timestamp()),
            rashin_id: cells.api_rashin_id,
            no: cells.api_no,
            color_no: cells.api_color_no,
            event_id: cells.api_event_id,
            event_kind: cells.api_event_kind,
            next: cells.api_next,
            e_deck_info: enemy_deck_info,
            limit_state: cells.api_limit_state,
            itemget,
            m1: None,
            destruction_battle: None,
            happening,
        })
    }
}

impl From<kcapi_main::api_req_map::start::ApiData> for InterfaceWrapper<Cells> {
    fn from(cells: kcapi_main::api_req_map::start::ApiData) -> Self {
        let cell = InterfaceWrapper::<Cell>::from(cells.clone()).unwrap();
        let cell_data: Vec<CellData> = cells
            .api_cell_data
            .into_iter()
            .map(|cell_data| InterfaceWrapper::<CellData>::from(cell_data).unwrap())
            .collect();

        Self(Cells {
            maparea_id: cells.api_maparea_id,
            mapinfo_no: cells.api_mapinfo_no,
            bosscell_no: cells.api_bosscell_no,
            bosscomp: cells.api_bosscomp,
            cells: vec![(cell.no, cell.clone())].into_iter().collect(),
            cell_index: vec![cell.no],
            event_map: cells
                .api_eventmap
                .map(|eventmap| InterfaceWrapper::<Eventmap>::from(eventmap).unwrap()),
            cell_data,
            battles: HashMap::new(),
        })
    }
}

pub fn calc_dmg(destruction_battle: &mut DestructionBattle) {
    let mut f_total_damages: Vec<i64> = vec![0; 6];
    let mut e_total_damages: Vec<i64> = vec![0; 6];

    let f_nowhps: Vec<i64> = destruction_battle.f_nowhps.clone();
    let e_nowhps: Vec<i64> = destruction_battle.e_nowhps.clone();

    f_nowhps.iter().enumerate().for_each(|(idx, &f_nowhp)| {
        destruction_battle.air_base_attack.f_damage.now_hps[idx] = f_nowhp - f_total_damages[idx];
    });

    e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
        destruction_battle.air_base_attack.e_damage.now_hps[idx] = e_nowhp - e_total_damages[idx];
    });

    destruction_battle
        .air_base_attack
        .f_damage
        .damages
        .clone()
        .unwrap_or(vec![0_f32; 0])
        .iter()
        .enumerate()
        .for_each(|(idx, &x)| {
            f_total_damages[idx] += x as i64;
        });

    destruction_battle
        .air_base_attack
        .e_damage
        .damages
        .clone()
        .unwrap_or(vec![0_f32; 0])
        .iter()
        .enumerate()
        .for_each(|(idx, &x)| {
            e_total_damages[idx] += x as i64;
        });

    destruction_battle.f_total_damages = Some(f_total_damages);
    destruction_battle.e_total_damages = Some(e_total_damages);
}
