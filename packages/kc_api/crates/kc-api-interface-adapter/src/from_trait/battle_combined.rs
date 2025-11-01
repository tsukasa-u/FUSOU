use std::vec;

use chrono::Local;

use crate::InterfaceWrapper;
use kc_api_dto::main as kcapi_main;

use super::battle::{calc_dmg, calc_escape_idx, unwrap_into};
use kc_api_interface::battle::BattleType;
use kc_api_interface::battle::{
    AirBaseAirAttacks, AirBaseAssult, Battle, CarrierBaseAssault, ClosingRaigeki,
    FriendlyForceAttack, Hougeki, MidnightHougeki, OpeningAirAttack, OpeningRaigeki, OpeningTaisen,
    SupportAttack,
};
use kc_api_interface::cells::KCS_CELLS_INDEX;

impl From<kcapi_main::api_req_combined_battle::ec_battle::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle: kcapi_main::api_req_combined_battle::ec_battle::ApiData) -> Self {
        let air_base_air_attacks: Option<AirBaseAirAttacks> =
            Some(unwrap_into(battle.api_air_base_attack));
        let opening_air_attack: Option<Vec<Option<OpeningAirAttack>>> =
            Some(vec![Some(unwrap_into(battle.api_kouku))]);
        let opening_taisen: Option<OpeningTaisen> = battle.api_opening_taisen.map(unwrap_into);
        let opening_raigeki: Option<OpeningRaigeki> = Some(unwrap_into(battle.api_opening_atack));
        let closing_taigeki: Option<ClosingRaigeki> = Some(unwrap_into(battle.api_raigeki));
        let hougeki_1: Option<Hougeki> = Some(unwrap_into(battle.api_hougeki1));
        let hougeki_2: Option<Hougeki> = Some(unwrap_into(battle.api_hougeki2));
        let hougeki_3: Option<Hougeki> = battle.api_hougeki3.map(unwrap_into);
        let support_attack: Option<SupportAttack> = battle.api_support_info.map(unwrap_into);
        let air_base_assault: Option<AirBaseAssult> =
            battle.api_air_base_injection.map(unwrap_into);
        let carrier_base_assault: Option<CarrierBaseAssault> =
            battle.api_injection_kouku.map(unwrap_into);

        let hougeki: Option<Vec<Option<Hougeki>>> =
            if hougeki_1.is_some() || hougeki_2.is_some() || hougeki_3.is_some() {
                Some(vec![hougeki_1, hougeki_2, hougeki_3])
            } else {
                None
            };

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
            BattleType::AirBaseAssult(()),
            BattleType::CarrierBaseAssault(()),
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
            BattleType::SupportAttack(()),
            BattleType::OpeningTaisen(()),
            BattleType::OpeningRaigeki(()),
            BattleType::Hougeki(0),
            BattleType::ClosingRaigeki(()),
            BattleType::Hougeki(1),
            BattleType::Hougeki(2),
        ];

        let escape_idx_combined: Option<Vec<i64>> = calc_escape_idx(battle.api_escape_idx, None);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some([battle.api_ship_ke, battle.api_ship_ke_combined].concat()),
            e_params: Some([battle.api_e_param, battle.api_e_param_combined].concat()),
            e_slot: Some([battle.api_e_slot, battle.api_e_slot_combined].concat()),
            e_hp_max: Some([battle.api_e_maxhps, battle.api_e_maxhps_combined].concat()),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: Some(battle.api_search),
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: battle.api_combat_ration,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault,
            carrier_base_assault,
            air_base_air_attacks,
            opening_air_attack,
            support_attack,
            opening_taisen,
            opening_raigeki,
            hougeki,
            closing_raigeki: closing_taigeki,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: Some(battle.api_f_nowhps),
            e_nowhps: Some([battle.api_e_nowhps, battle.api_e_nowhps_combined].concat()),
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
        })
        .unwrap();
        calc_dmg(&mut ret);
        return Self(ret);
    }
}

impl From<kcapi_main::api_req_combined_battle::ec_midnight_battle::ApiData>
    for InterfaceWrapper<Battle>
{
    fn from(battle: kcapi_main::api_req_combined_battle::ec_midnight_battle::ApiData) -> Self {
        let midnight_hougeki: Option<MidnightHougeki> = Some(unwrap_into(battle.api_hougeki));
        let friendly_force_attack: Option<FriendlyForceAttack> =
            if battle.api_friendly_info.is_some() && battle.api_friendly_battle.is_some() {
                Some(
                    InterfaceWrapper::from_api_data(
                        battle.api_friendly_info.unwrap(),
                        battle.api_friendly_battle.unwrap(),
                    )
                    .unwrap(),
                )
            } else {
                None
            };

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
            BattleType::AirBaseAssult(()),
            BattleType::CarrierBaseAssault(()),
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
            BattleType::SupportAttack(()),
            BattleType::OpeningTaisen(()),
            BattleType::OpeningRaigeki(()),
            BattleType::Hougeki(0),
            BattleType::ClosingRaigeki(()),
            BattleType::Hougeki(1),
            BattleType::Hougeki(2),
            BattleType::FriendlyForceAttack(()),
            BattleType::MidnightHougeki(()),
        ];

        let escape_idx_combined: Option<Vec<i64>> = calc_escape_idx(battle.api_escape_idx, None);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: None,
            midnight_timestamp: Some(Local::now().timestamp()),
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some([battle.api_ship_ke, battle.api_ship_ke_combined].concat()),
            e_params: Some([battle.api_e_param, battle.api_e_param_combined].concat()),
            e_slot: Some([battle.api_e_slot, battle.api_e_slot_combined].concat()),
            e_hp_max: Some([battle.api_e_maxhps, battle.api_e_maxhps_combined].concat()),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: None,
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: None,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault: None,
            carrier_base_assault: None,
            air_base_air_attacks: None,
            opening_air_attack: None,
            support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            friendly_force_attack,
            midnight_flare_pos: Some(battle.api_flare_pos),
            midnight_touchplane: Some(battle.api_touch_plane),
            midnight_hougeki,
            f_nowhps: None,
            e_nowhps: None,
            midnight_f_nowhps: Some(battle.api_f_nowhps),
            midnight_e_nowhps: Some([battle.api_e_nowhps, battle.api_e_nowhps_combined].concat()),
        })
        .unwrap();
        calc_dmg(&mut ret);
        return Self(ret);
    }
}

impl From<kcapi_main::api_req_combined_battle::battle_water::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle: kcapi_main::api_req_combined_battle::battle_water::ApiData) -> Self {
        let air_base_air_attacks: Option<AirBaseAirAttacks> =
            battle.api_air_base_attack.map(unwrap_into);
        let opening_air_attack: Option<Vec<Option<OpeningAirAttack>>> =
            Some(vec![Some(unwrap_into(battle.api_kouku))]);
        let opening_taisen: Option<OpeningTaisen> = battle.api_opening_taisen.map(unwrap_into);
        let opening_raigeki: Option<OpeningRaigeki> = battle.api_opening_atack.map(unwrap_into);
        let closing_taigeki: Option<ClosingRaigeki> = battle.api_raigeki.map(unwrap_into);
        let hougeki_1: Option<Hougeki> = battle.api_hougeki1.map(unwrap_into);
        let hougeki_2: Option<Hougeki> = battle.api_hougeki2.map(unwrap_into);
        let hougeki_3: Option<Hougeki> = battle.api_hougeki3.map(unwrap_into);
        let support_attack: Option<SupportAttack> = battle.api_support_info.map(unwrap_into);
        let air_base_assault: Option<AirBaseAssult> =
            battle.api_air_base_injection.map(unwrap_into);
        let carrier_base_assault: Option<CarrierBaseAssault> =
            battle.api_injection_kouku.map(unwrap_into);

        let hougeki: Option<Vec<Option<Hougeki>>> =
            if hougeki_1.is_some() || hougeki_2.is_some() || hougeki_3.is_some() {
                Some(vec![hougeki_1, hougeki_2, hougeki_3])
            } else {
                None
            };

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
            BattleType::AirBaseAssult(()),
            BattleType::CarrierBaseAssault(()),
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
            BattleType::SupportAttack(()),
            BattleType::OpeningTaisen(()),
            BattleType::OpeningRaigeki(()),
            BattleType::Hougeki(0),
            BattleType::ClosingRaigeki(()),
            BattleType::Hougeki(1),
            BattleType::Hougeki(2),
        ];

        let escape_idx_combined: Option<Vec<i64>> =
            calc_escape_idx(battle.api_escape_idx, battle.api_escape_idx_combined);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_params: Some(battle.api_e_param),
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: Some(battle.api_search),
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: battle.api_combat_ration,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault,
            carrier_base_assault,
            air_base_air_attacks,
            opening_air_attack,
            support_attack,
            opening_taisen,
            opening_raigeki,
            hougeki,
            closing_raigeki: closing_taigeki,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: Some([battle.api_f_nowhps, battle.api_f_nowhps_combined].concat()),
            e_nowhps: Some(battle.api_e_nowhps),
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
        })
        .unwrap();
        calc_dmg(&mut ret);
        return Self(ret);
    }
}

impl From<kcapi_main::api_req_combined_battle::battle::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle: kcapi_main::api_req_combined_battle::battle::ApiData) -> Self {
        let air_base_air_attacks: Option<AirBaseAirAttacks> =
            battle.api_air_base_attack.map(unwrap_into);
        let opening_air_attack: Option<Vec<Option<OpeningAirAttack>>> =
            Some(vec![Some(unwrap_into(battle.api_kouku))]);
        let opening_taisen: Option<OpeningTaisen> = battle.api_opening_taisen.map(unwrap_into);
        let opening_raigeki: Option<OpeningRaigeki> = Some(unwrap_into(battle.api_opening_atack));
        let closing_taigeki: Option<ClosingRaigeki> = battle.api_raigeki.map(unwrap_into);
        let hougeki_1: Option<Hougeki> = Some(unwrap_into(battle.api_hougeki1));
        let hougeki_2: Option<Hougeki> = battle.api_hougeki2.map(unwrap_into);
        let hougeki_3: Option<Hougeki> = battle.api_hougeki3.map(unwrap_into);
        let support_attack: Option<SupportAttack> = battle.api_support_info.map(unwrap_into);
        let air_base_assault: Option<AirBaseAssult> =
            battle.api_air_base_injection.map(unwrap_into);
        let carrier_base_assault: Option<CarrierBaseAssault> =
            battle.api_injection_kouku.map(unwrap_into);

        let hougeki: Option<Vec<Option<Hougeki>>> =
            if hougeki_1.is_some() || hougeki_2.is_some() || hougeki_3.is_some() {
                Some(vec![hougeki_1, hougeki_2, hougeki_3])
            } else {
                None
            };

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
            BattleType::AirBaseAssult(()),
            BattleType::CarrierBaseAssault(()),
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
            BattleType::SupportAttack(()),
            BattleType::OpeningTaisen(()),
            BattleType::OpeningRaigeki(()),
            BattleType::Hougeki(0),
            BattleType::ClosingRaigeki(()),
            BattleType::Hougeki(1),
            BattleType::Hougeki(2),
        ];

        let escape_idx_combined: Option<Vec<i64>> =
            calc_escape_idx(battle.api_escape_idx, battle.api_escape_idx_combined);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_params: Some(battle.api_e_param),
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: Some(battle.api_search),
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: battle.api_combat_ration,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault,
            carrier_base_assault,
            air_base_air_attacks,
            opening_air_attack,
            support_attack,
            opening_taisen,
            opening_raigeki,
            hougeki,
            closing_raigeki: closing_taigeki,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: Some([battle.api_f_nowhps, battle.api_f_nowhps_combined].concat()),
            e_nowhps: Some(battle.api_e_nowhps),
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
        })
        .unwrap();
        calc_dmg(&mut ret);
        return Self(ret);
    }
}

impl From<kcapi_main::api_req_combined_battle::each_battle_water::ApiData>
    for InterfaceWrapper<Battle>
{
    fn from(battle: kcapi_main::api_req_combined_battle::each_battle_water::ApiData) -> Self {
        let air_base_air_attacks: Option<AirBaseAirAttacks> =
            battle.api_air_base_attack.map(unwrap_into);
        let opening_air_attack: Option<Vec<Option<OpeningAirAttack>>> =
            Some(vec![Some(unwrap_into(battle.api_kouku))]);
        let opening_taisen: Option<OpeningTaisen> = battle.api_opening_taisen.map(unwrap_into);
        let opening_raigeki: Option<OpeningRaigeki> = Some(unwrap_into(battle.api_opening_atack));
        let closing_taigeki: Option<ClosingRaigeki> = Some(unwrap_into(battle.api_raigeki));
        let hougeki_1: Option<Hougeki> = Some(unwrap_into(battle.api_hougeki1));
        let hougeki_2: Option<Hougeki> = Some(unwrap_into(battle.api_hougeki2));
        let hougeki_3: Option<Hougeki> = battle.api_hougeki3.map(unwrap_into);
        let support_attack: Option<SupportAttack> = battle.api_support_info.map(unwrap_into);
        let air_base_assault: Option<AirBaseAssult> =
            battle.api_air_base_injection.map(unwrap_into);
        let carrier_base_assault: Option<CarrierBaseAssault> =
            battle.api_injection_kouku.map(unwrap_into);

        let hougeki: Option<Vec<Option<Hougeki>>> =
            if hougeki_1.is_some() || hougeki_2.is_some() || hougeki_3.is_some() {
                Some(vec![hougeki_1, hougeki_2, hougeki_3])
            } else {
                None
            };

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
            BattleType::AirBaseAssult(()),
            BattleType::CarrierBaseAssault(()),
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
            BattleType::SupportAttack(()),
            BattleType::OpeningTaisen(()),
            BattleType::OpeningRaigeki(()),
            BattleType::Hougeki(0),
            BattleType::ClosingRaigeki(()),
            BattleType::Hougeki(1),
            BattleType::Hougeki(2),
        ];

        let escape_idx_combined: Option<Vec<i64>> =
            calc_escape_idx(battle.api_escape_idx, battle.api_escape_idx_combined);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some([battle.api_ship_ke, battle.api_ship_ke_combined].concat()),
            e_params: Some([battle.api_e_param, battle.api_e_param_combined].concat()),
            e_slot: Some([battle.api_e_slot, battle.api_e_slot_combined].concat()),
            e_hp_max: Some([battle.api_e_maxhps, battle.api_e_maxhps_combined].concat()),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: Some(battle.api_search),
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: battle.api_combat_ration,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault,
            carrier_base_assault,
            air_base_air_attacks,
            opening_air_attack,
            support_attack,
            opening_taisen,
            opening_raigeki,
            hougeki,
            closing_raigeki: closing_taigeki,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: Some([battle.api_f_nowhps, battle.api_f_nowhps_combined].concat()),
            e_nowhps: Some([battle.api_e_nowhps, battle.api_e_nowhps_combined].concat()),
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
        })
        .unwrap();
        calc_dmg(&mut ret);
        return Self(ret);
    }
}

impl From<kcapi_main::api_req_combined_battle::each_battle::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle: kcapi_main::api_req_combined_battle::each_battle::ApiData) -> Self {
        let air_base_air_attacks: Option<AirBaseAirAttacks> =
            battle.api_air_base_attack.map(unwrap_into);
        let opening_air_attack: Option<Vec<Option<OpeningAirAttack>>> =
            Some(vec![Some(unwrap_into(battle.api_kouku))]);
        let opening_taisen: Option<OpeningTaisen> = battle.api_opening_taisen.map(unwrap_into);
        let opening_raigeki: Option<OpeningRaigeki> = Some(unwrap_into(battle.api_opening_atack));
        let closing_taigeki: Option<ClosingRaigeki> = Some(unwrap_into(battle.api_raigeki));
        let hougeki_1: Option<Hougeki> = Some(unwrap_into(battle.api_hougeki1));
        let hougeki_2: Option<Hougeki> = battle.api_hougeki2.map(unwrap_into);
        let hougeki_3: Option<Hougeki> = battle.api_hougeki3.map(unwrap_into);
        let support_attack: Option<SupportAttack> = battle.api_support_info.map(unwrap_into);
        let air_base_assault: Option<AirBaseAssult> =
            battle.api_air_base_injection.map(unwrap_into);
        let carrier_base_assault: Option<CarrierBaseAssault> =
            battle.api_injection_kouku.map(unwrap_into);

        let hougeki: Option<Vec<Option<Hougeki>>> =
            if hougeki_1.is_some() || hougeki_2.is_some() || hougeki_3.is_some() {
                Some(vec![hougeki_1, hougeki_2, hougeki_3])
            } else {
                None
            };

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
            BattleType::AirBaseAssult(()),
            BattleType::CarrierBaseAssault(()),
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
            BattleType::SupportAttack(()),
            BattleType::OpeningTaisen(()),
            BattleType::OpeningRaigeki(()),
            BattleType::Hougeki(0),
            BattleType::ClosingRaigeki(()),
            BattleType::Hougeki(1),
            BattleType::Hougeki(2),
        ];

        let escape_idx_combined: Option<Vec<i64>> =
            calc_escape_idx(battle.api_escape_idx, battle.api_escape_idx_combined);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some([battle.api_ship_ke, battle.api_ship_ke_combined].concat()),
            e_params: Some([battle.api_e_param, battle.api_e_param_combined].concat()),
            e_slot: Some([battle.api_e_slot, battle.api_e_slot_combined].concat()),
            e_hp_max: Some([battle.api_e_maxhps, battle.api_e_maxhps_combined].concat()),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: Some(battle.api_search),
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: battle.api_combat_ration,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault,
            carrier_base_assault,
            air_base_air_attacks,
            opening_air_attack,
            support_attack,
            opening_taisen,
            opening_raigeki,
            hougeki,
            closing_raigeki: closing_taigeki,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: Some([battle.api_f_nowhps, battle.api_f_nowhps_combined].concat()),
            e_nowhps: Some([battle.api_e_nowhps, battle.api_e_nowhps_combined].concat()),
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
        })
        .unwrap();
        calc_dmg(&mut ret);
        return Self(ret);
    }
}

impl From<kcapi_main::api_req_combined_battle::ld_airbattle::ApiData> for InterfaceWrapper<Battle> {
    fn from(airbattle: kcapi_main::api_req_combined_battle::ld_airbattle::ApiData) -> Self {
        // let air_base_air_attacks: Option<AirBaseAirAttacks> = airbattle
        //     .api_air_base_attack
        //     .map(|air_base_air_attack| air_base_air_attack.into());
        let air_base_air_attacks: Option<AirBaseAirAttacks> = None;
        let opening_air_attack: Option<Vec<Option<OpeningAirAttack>>> =
            Some(vec![Some(unwrap_into(airbattle.api_kouku))]);

        // Need to resarch this
        // let support_attack: Option<SupportAttack> = airbattle.api_support_info.and_then(|support_info| Some(support_info.into()));
        // let air_base_assault: Option<AirBaseAssult> = airbattle.api_air_base_injection.and_then(|air_base_injection| Some(air_base_injection.into()));
        // let carrier_base_assault: Option<CarrierBaseAssault> = airbattle.api_injection_kouku.and_then(|injection_kouku| Some(injection_kouku.into());
        let support_attack: Option<SupportAttack> = None;
        let air_base_assault: Option<AirBaseAssult> = None;
        let carrier_base_assault: Option<CarrierBaseAssault> = None;

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
        ];

        let escape_idx_combined: Option<Vec<i64>> =
            calc_escape_idx(airbattle.api_escape_idx, airbattle.api_escape_idx_combined);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(airbattle.api_deck_id),
            formation: Some(airbattle.api_formation),
            enemy_ship_id: Some(airbattle.api_ship_ke),
            e_params: Some(airbattle.api_e_param),
            e_slot: Some(airbattle.api_e_slot),
            e_hp_max: Some(airbattle.api_e_maxhps),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: Some(airbattle.api_search),
            escape_idx: escape_idx_combined,
            smoke_type: Some(airbattle.api_smoke_type),
            combat_ration: None,
            balloon_flag: Some(airbattle.api_balloon_cell),
            air_base_assault,
            carrier_base_assault,
            air_base_air_attacks,
            opening_air_attack,
            support_attack,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: Some([airbattle.api_f_nowhps, airbattle.api_f_nowhps_combined].concat()),
            e_nowhps: Some(airbattle.api_e_nowhps),
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
        })
        .unwrap();
        calc_dmg(&mut ret);
        return Self(ret);
    }
}

impl From<kcapi_main::api_req_combined_battle::midnight_battle::ApiData>
    for InterfaceWrapper<Battle>
{
    fn from(battle: kcapi_main::api_req_combined_battle::midnight_battle::ApiData) -> Self {
        let midnight_hougeki: Option<MidnightHougeki> = Some(unwrap_into(battle.api_hougeki));
        let friendly_force_attack: Option<FriendlyForceAttack> = None;

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
            BattleType::FriendlyForceAttack(()),
            BattleType::MidnightHougeki(()),
        ];

        let escape_idx_combined: Option<Vec<i64>> =
            calc_escape_idx(battle.api_escape_idx, battle.api_escape_idx_combined);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: None,
            midnight_timestamp: Some(Local::now().timestamp()),
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_params: Some(battle.api_e_param),
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: None,
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: None,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault: None,
            carrier_base_assault: None,
            air_base_air_attacks: None,
            opening_air_attack: None,
            support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            friendly_force_attack,
            midnight_flare_pos: Some(battle.api_flare_pos),
            midnight_touchplane: Some(battle.api_touch_plane),
            midnight_hougeki,
            f_nowhps: None,
            e_nowhps: None,
            midnight_f_nowhps: Some([battle.api_f_nowhps, battle.api_f_nowhps_combined].concat()),
            midnight_e_nowhps: Some(battle.api_e_nowhps),
        })
        .unwrap();
        calc_dmg(&mut ret);
        return Self(ret);
    }
}

impl From<kcapi_main::api_req_combined_battle::sp_midnight::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle: kcapi_main::api_req_combined_battle::sp_midnight::ApiData) -> Self {
        let midnight_hougeki: Option<MidnightHougeki> = Some(unwrap_into(battle.api_hougeki));
        let friendly_force_attack: Option<FriendlyForceAttack> = None;

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
            BattleType::FriendlyForceAttack(()),
            BattleType::MidnightHougeki(()),
        ];

        let escape_idx_combined: Option<Vec<i64>> =
            calc_escape_idx(battle.api_escape_idx, battle.api_escape_idx_combined);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: None,
            midnight_timestamp: Some(Local::now().timestamp()),
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_params: Some(battle.api_e_param),
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: None,
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: None,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault: None,
            carrier_base_assault: None,
            air_base_air_attacks: None,
            opening_air_attack: None,
            support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            friendly_force_attack,
            midnight_flare_pos: Some(battle.api_flare_pos),
            midnight_touchplane: Some(battle.api_touch_plane),
            midnight_hougeki,
            f_nowhps: None,
            e_nowhps: None,
            midnight_f_nowhps: Some([battle.api_f_nowhps, battle.api_f_nowhps_combined].concat()),
            midnight_e_nowhps: Some(battle.api_e_nowhps),
        })
        .unwrap();
        calc_dmg(&mut ret);
        return Self(ret);
    }
}
