use chrono::Local;

use crate::kcapi::{self, api_get_member::preset_deck::N};

use super::{battle::{Battle, MidnightHougeki}, cells::KCS_CELLS};
use crate::interface::battle::{AirBaseAirAttacks, OpeningAirAttack, OpeningTaisen, OpeningRaigeki, ClosingRaigeki, Hougeki, SupportAttack};

impl From<kcapi::api_req_combined_battle::ec_battle::ApiData> for Battle {
    fn from(battle: kcapi::api_req_combined_battle::ec_battle::ApiData) -> Self {
        
        let air_base_air_attacks: Option<AirBaseAirAttacks> = Some(battle.api_air_base_attack.into());
        let opening_air_attack: Option<OpeningAirAttack> = Some(battle.api_kouku.into());
        let opening_taisen: Option<OpeningTaisen> = None;
        let opening_raigeki: Option<OpeningRaigeki> = Some(battle.api_opening_atack.into());
        let closing_taigeki: Option<ClosingRaigeki> = Some(battle.api_raigeki.into());
        let hougeki_1: Option<Hougeki> = Some(battle.api_hougeki1.into());
        let hougeki_2: Option<Hougeki> = Some(battle.api_hougeki2.into());
        let hougeki_3: Option<Hougeki> = battle.api_hougeki3.and_then(|hougeki| Some(hougeki.into()));
        let support_attack: Option<SupportAttack> = None;
        
        let hougeki: Option<Vec<Option<Hougeki>>> = if hougeki_1.is_some() || hougeki_2.is_some() || hougeki_3.is_some() { Some(vec![hougeki_1, hougeki_2, hougeki_3]) } else { None };

        let cell_no = KCS_CELLS.lock().and_then(|cells| Ok(cells.last().unwrap_or(&0).clone())).unwrap_or(0);

        Self {
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some([battle.api_ship_ke, battle.api_ship_ke_combined].concat()),
            e_params: Some([battle.api_e_param, battle.api_e_param_combined].concat()),
            e_slot: Some([battle.api_e_slot, battle.api_e_slot_combined].concat()),
            e_hp_max: Some([battle.api_e_maxhps, battle.api_e_maxhps_combined].concat()),
            total_damages_friends: None,
            total_damages_enemies: None,
            reconnaissance: Some(battle.api_search),
            forward_observe: None,
            escape_idx: None,
            smoke_type: Some(battle.api_smoke_type),
            // air_base_assault: None,
            // carrier_base_assault: None,
            air_base_air_attacks: air_base_air_attacks,
            opening_air_attack: opening_air_attack,
            support_attack: support_attack,
            opening_taisen: opening_taisen,
            opening_raigeki: opening_raigeki,
            hougeki: hougeki,
            closing_raigeki: closing_taigeki,
            // friendly_fleet_attack: None,
            midnight_flare_pos: None,
            midngiht_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: Some(battle.api_f_nowhps),
            e_nowhps: Some([battle.api_e_nowhps, battle.api_e_nowhps_combined].concat()),
            midngiht_f_nowhps: None,
            midngiht_e_nowhps: None,
        }
    }
}

impl From<kcapi::api_req_combined_battle::ec_midnight_battle::ApiData> for Battle {
    fn from(battle: kcapi::api_req_combined_battle::ec_midnight_battle::ApiData) -> Self {
        let midnight_hougeki: Option<MidnightHougeki> = Some(battle.api_hougeki.into());

        let cell_no = KCS_CELLS.lock().and_then(|cells| Ok(cells.last().unwrap_or(&0).clone())).unwrap_or(0);

        Self {
            timestamp: None,
            midnight_timestamp: Some(Local::now().timestamp()),
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some([battle.api_ship_ke, battle.api_ship_ke_combined].concat()),
            e_params: Some([battle.api_e_param, battle.api_e_param_combined].concat()),
            e_slot: Some([battle.api_e_slot, battle.api_e_slot_combined].concat()),
            e_hp_max: Some([battle.api_e_maxhps, battle.api_e_maxhps_combined].concat()),
            total_damages_friends: None,
            total_damages_enemies: None,
            reconnaissance: None,
            forward_observe: None,
            escape_idx: battle.api_escape_idx,
            smoke_type: Some(battle.api_smoke_type),
            // air_base_assault: None,
            // carrier_base_assault: None,
            air_base_air_attacks: None,
            opening_air_attack: None,
            support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            // friendly_fleet_attack: None,
            midnight_flare_pos: Some(battle.api_flare_pos),
            midngiht_touchplane: Some(battle.api_touch_plane),
            midnight_hougeki: midnight_hougeki,
            f_nowhps: None,
            e_nowhps: None,
            midngiht_f_nowhps: Some(battle.api_f_nowhps),
            midngiht_e_nowhps: Some([battle.api_e_nowhps, battle.api_e_nowhps_combined].concat()),
        }
    }
}

// impl From<kcapi::api_req_combined_battle::battle_water::ApiData> for Battle {
//     fn from(battle: kcapi::api_req_combined_battle::battle_water::ApiData) -> Self {
//         let air_base_air_attacks: Option<AirBaseAirAttacks> = match battle.api_air_base_attack {
//             Some(air_base_air_attack) => Some(AirBaseAirAttacks {
//                 attacks: air_base_air_attack.iter().map(|air_base_air_attack| air_base_air_attack.clone().into()).collect(),
//             }),
//             None => None,
//         };
//         let opening_air_attack: Option<OpeningAirAttack> = Some(battle.api_kouku.into());
//         let opening_taisen: Option<OpeningTaisen> = match battle.api_opening_taisen {
//             Some(opening_taisen) => Some(opening_taisen.into()),
//             None => None,
//         };
//         let opening_raigeki: Option<OpeningRaigeki> = match battle.api_opening_atack {
//             Some(opening_attack) => Some(opening_attack.into()),
//             None => None,
//         };
//         let closing_taigeki: Option<ClosingRaigeki> = match battle.api_raigeki {
//             Some(closing_raigeki) => Some(closing_raigeki.into()),
//             None => None,
//         };
//         let hougeki_1: Option<Hougeki> = match battle.api_hougeki1 {
//             Some(hougeki) => Some(hougeki.into()),
//             None => None,
//         };
//         let hougeki_2: Option<Hougeki> = match battle.api_hougeki2 {
//             Some(hougeki) => Some(hougeki.into()),
//             None => None,
//         };
//         // Need to implement hougeki_3
//         let hougeki_3: Option<Hougeki> = match battle.api_hougeki3 {
//             _ => None,
//         };
//         let hougeki: Option<Vec<Option<Hougeki>>> = if hougeki_1.is_some() || hougeki_2.is_some() || hougeki_3.is_some() {
//             Some(vec![hougeki_1, hougeki_2, hougeki_3])
//         } else {
//             None
//         };
        
//         // let support_attack: Option<SupportAttack> = match battle.api_support_info {
//         //     Some(support_attack) => Some(support_attack.into()),
//         //     None => None,
//         // };
//         let support_attack: Option<SupportAttack> = None;

//         let cell_no = match KCS_CELLS.lock().unwrap().last() {
//             Some(cell) => cell.clone(),
//             None => 0,
//         };

//         Self {
//             timestamp: Some(Local::now().timestamp()),
//             midnight_timestamp: None,
//             cell_id: cell_no,
//             deck_id: Some(battle.api_deck_id),
//             formation: Some(battle.api_formation),
//             enemy_ship_id: Some(battle.api_ship_ke),
//             e_params: Some(battle.api_e_param),
//             e_slot: Some(battle.api_e_slot),
//             e_hp_max: Some(battle.api_e_maxhps),
//             total_damages_friends: None,
//             total_damages_enemies: None,
//             reconnaissance: Some(battle.api_search),
//             forward_observe: None,
//             escape_idx: None,
//             smoke_type: Some(battle.api_smoke_type),
//             // air_base_assault: None,
//             // carrier_base_assault: None,
//             air_base_air_attacks: air_base_air_attacks,
//             opening_air_attack: opening_air_attack,
//             support_attack: support_attack,
//             opening_taisen: opening_taisen,
//             opening_raigeki: opening_raigeki,
//             hougeki: hougeki,
//             closing_raigeki: closing_taigeki,
//             // friendly_fleet_attack: None,
//             midnight_flare_pos: None,
//             midngiht_touchplane: None,
//             midnight_hougeki: None,
//         }
//     }
// }