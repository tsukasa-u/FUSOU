#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_port@port.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_port/port)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

use register_trait::{add_field, register_struct};

use register_trait::{Getter, TraitForConvert, TraitForRoot, TraitForTest};

use crate::interface::deck_port::DeckPorts;
use crate::interface::interface::{EmitData, Identifier, Set};
use crate::interface::logs::Logs;
use crate::interface::material::Materials;
use crate::interface::n_dock::NDocks;
use crate::interface::ship::Ships;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Req {
    #[serde(rename = "api_token")]
    pub api_token: String,
    #[serde(rename = "api_verno")]
    pub api_verno: String,
    #[serde(rename = "api_port")]
    pub api_port: String,
    #[serde(rename = "api_sort_key")]
    pub api_sort_key: String,
    #[serde(rename = "spi_sort_order")]
    pub api_sort_order: String,
}

#[derive(Getter, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_port/port")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Res {
    #[serde(rename = "api_result")]
    pub api_result: i64,
    #[serde(rename = "api_result_msg")]
    pub api_result_msg: String,
    #[serde(rename = "api_data")]
    pub api_data: ApiData,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_event_object")]
    pub api_event_object: Option<ApiEventObject>,
    #[serde(rename = "api_material")]
    pub api_material: Vec<ApiMaterial>,
    #[serde(rename = "api_deck_port")]
    pub api_deck_port: Vec<ApiDeckPort>,
    #[serde(rename = "api_ndock")]
    pub api_ndock: Vec<ApiNdock>,
    #[serde(rename = "api_ship")]
    pub api_ship: Vec<ApiShip>,
    #[serde(rename = "api_basic")]
    pub api_basic: ApiBasic,
    #[serde(rename = "api_log")]
    pub api_log: Vec<ApiLog>,
    #[serde(rename = "api_combined_flag")]
    pub api_combined_flag: Option<i64>,
    #[serde(rename = "api_p_bgm_id")]
    pub api_p_bgm_id: i64,
    #[serde(rename = "api_furniture_affect_items")]
    pub api_furniture_affect_items: ApiFurnitureAffectItems,
    #[serde(rename = "api_parallel_quest_count")]
    pub api_parallel_quest_count: i64,
    #[serde(rename = "api_dest_ship_slot")]
    pub api_dest_ship_slot: i64,
    #[serde(rename = "api_c_flags")]
    pub api_c_flags: Option<Vec<i64>>,
    #[serde(rename = "api_friendly_setting")]
    pub api_friendly_setting: Option<ApiFriendlySetting>,
    #[serde(rename = "api_plane_info")]
    pub api_plane_info: Option<ApiPlaneInfo>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiPlaneInfo {
    #[serde(rename = "api_base_convert_slot")]
    pub api_base_convert_slot: Option<Vec<i64>>,
    #[serde(rename = "api_unset_slot")]
    pub api_unset_slot: Option<Vec<ApiUnsetSlot>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiUnsetSlot {
    #[serde(rename = "api_type3No")]
    api_type3_no: i64,
    #[serde(rename = "api_slot_list")]
    api_slot_list: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFriendlySetting {
    #[serde(rename = "api_request_flag")]
    api_request_flag: i64,
    #[serde(rename = "api_request_type")]
    api_request_type: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEventObject {
    #[serde(rename = "api_c_num")]
    pub api_c_num: Option<i64>,
    #[serde(rename = "api_m_flag")]
    pub api_m_flag: Option<i64>,
    #[serde(rename = "api_m_flag2")]
    pub api_m_flag2: Option<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMaterial {
    #[serde(rename = "api_member_id")]
    pub api_member_id: i64,
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_value")]
    pub api_value: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDeckPort {
    #[serde(rename = "api_member_id")]
    pub api_member_id: i64,
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_name_id")]
    pub api_name_id: String,
    #[serde(rename = "api_mission")]
    pub api_mission: Vec<i64>,
    #[serde(rename = "api_flagship")]
    pub api_flagship: String,
    #[serde(rename = "api_ship")]
    pub api_ship: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiNdock {
    #[serde(rename = "api_member_id")]
    pub api_member_id: i64,
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_state")]
    pub api_state: i64,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: i64,
    #[serde(rename = "api_complete_time")]
    pub api_complete_time: i64,
    #[serde(rename = "api_complete_time_str")]
    pub api_complete_time_str: String,
    #[serde(rename = "api_item1")]
    pub api_item1: i64,
    #[serde(rename = "api_item2")]
    pub api_item2: i64,
    #[serde(rename = "api_item3")]
    pub api_item3: i64,
    #[serde(rename = "api_item4")]
    pub api_item4: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiShip {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_sortno")]
    pub api_sortno: i64,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: i64,
    #[serde(rename = "api_lv")]
    pub api_lv: i64,
    #[serde(rename = "api_exp")]
    pub api_exp: Vec<i64>,
    #[serde(rename = "api_nowhp")]
    pub api_nowhp: i64,
    #[serde(rename = "api_maxhp")]
    pub api_maxhp: i64,
    #[serde(rename = "api_soku")]
    pub api_soku: i64,
    #[serde(rename = "api_leng")]
    pub api_leng: i64,
    #[serde(rename = "api_slot")]
    pub api_slot: Vec<i64>,
    #[serde(rename = "api_onslot")]
    pub api_onslot: Vec<i64>,
    #[serde(rename = "api_slot_ex")]
    pub api_slot_ex: i64,
    #[serde(rename = "api_kyouka")]
    pub api_kyouka: Vec<i64>,
    #[serde(rename = "api_backs")]
    pub api_backs: i64,
    #[serde(rename = "api_fuel")]
    pub api_fuel: i64,
    #[serde(rename = "api_bull")]
    pub api_bull: i64,
    #[serde(rename = "api_slotnum")]
    pub api_slotnum: i64,
    #[serde(rename = "api_ndock_time")]
    pub api_ndock_time: i64,
    #[serde(rename = "api_ndock_item")]
    pub api_ndock_item: Vec<i64>,
    #[serde(rename = "api_srate")]
    pub api_srate: i64,
    #[serde(rename = "api_cond")]
    pub api_cond: i64,
    #[serde(rename = "api_karyoku")]
    pub api_karyoku: Vec<i64>,
    #[serde(rename = "api_raisou")]
    pub api_raisou: Vec<i64>,
    #[serde(rename = "api_taiku")]
    pub api_taiku: Vec<i64>,
    #[serde(rename = "api_soukou")]
    pub api_soukou: Vec<i64>,
    #[serde(rename = "api_kaihi")]
    pub api_kaihi: Vec<i64>,
    #[serde(rename = "api_taisen")]
    pub api_taisen: Vec<i64>,
    #[serde(rename = "api_sakuteki")]
    pub api_sakuteki: Vec<i64>,
    #[serde(rename = "api_lucky")]
    pub api_lucky: Vec<i64>,
    #[serde(rename = "api_locked")]
    pub api_locked: i64,
    #[serde(rename = "api_locked_equip")]
    pub api_locked_equip: i64,
    #[serde(rename = "api_sally_area")]
    pub api_sally_area: Option<i64>,
    #[serde(rename = "api_sp_effect_items")]
    pub api_sp_effect_items: Option<Vec<ApiSpEffectItem>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSpEffectItem {
    #[serde(rename = "api_kind")]
    pub api_kind: i64,
    #[serde(rename = "api_raig")]
    pub api_raig: Option<i64>,
    #[serde(rename = "api_souk")]
    pub api_souk: Option<i64>,
    #[serde(rename = "api_houg")]
    pub api_houg: Option<i64>,
    #[serde(rename = "api_kaih")]
    pub api_kaih: Option<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiBasic {
    #[serde(rename = "api_member_id")]
    pub api_member_id: String,
    #[serde(rename = "api_nickname")]
    pub api_nickname: String,
    #[serde(rename = "api_nickname_id")]
    pub api_nickname_id: String,
    #[serde(rename = "api_active_flag")]
    pub api_active_flag: i64,
    #[serde(rename = "api_starttime")]
    pub api_starttime: i64,
    #[serde(rename = "api_level")]
    pub api_level: i64,
    #[serde(rename = "api_rank")]
    pub api_rank: i64,
    #[serde(rename = "api_experience")]
    pub api_experience: i64,
    #[serde(rename = "api_fleetname")]
    pub api_fleetname: Value,
    #[serde(rename = "api_comment")]
    pub api_comment: String,
    #[serde(rename = "api_comment_id")]
    pub api_comment_id: String,
    #[serde(rename = "api_max_chara")]
    pub api_max_chara: i64,
    #[serde(rename = "api_max_slotitem")]
    pub api_max_slotitem: i64,
    #[serde(rename = "api_max_kagu")]
    pub api_max_kagu: i64,
    #[serde(rename = "api_playtime")]
    pub api_playtime: i64,
    #[serde(rename = "api_tutorial")]
    pub api_tutorial: i64,
    #[serde(rename = "api_furniture")]
    pub api_furniture: Vec<i64>,
    #[serde(rename = "api_count_deck")]
    pub api_count_deck: i64,
    #[serde(rename = "api_count_kdock")]
    pub api_count_kdock: i64,
    #[serde(rename = "api_count_ndock")]
    pub api_count_ndock: i64,
    #[serde(rename = "api_fcoin")]
    pub api_fcoin: i64,
    #[serde(rename = "api_st_win")]
    pub api_st_win: i64,
    #[serde(rename = "api_st_lose")]
    pub api_st_lose: i64,
    #[serde(rename = "api_ms_count")]
    pub api_ms_count: i64,
    #[serde(rename = "api_ms_success")]
    pub api_ms_success: i64,
    #[serde(rename = "api_pt_win")]
    pub api_pt_win: i64,
    #[serde(rename = "api_pt_lose")]
    pub api_pt_lose: i64,
    #[serde(rename = "api_pt_challenged")]
    pub api_pt_challenged: i64,
    #[serde(rename = "api_pt_challenged_win")]
    pub api_pt_challenged_win: i64,
    #[serde(rename = "api_firstflag")]
    pub api_firstflag: i64,
    #[serde(rename = "api_tutorial_progress")]
    pub api_tutorial_progress: i64,
    #[serde(rename = "api_pvp")]
    pub api_pvp: Vec<i64>,
    #[serde(rename = "api_medals")]
    pub api_medals: i64,
    #[serde(rename = "api_large_dock")]
    pub api_large_dock: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiLog {
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_type")]
    pub api_type: String,
    #[serde(rename = "api_state")]
    pub api_state: String,
    #[serde(rename = "api_message")]
    pub api_message: String,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFurnitureAffectItems {
    #[serde(rename = "api_payitem_dict")]
    pub api_payitem_dict: HashMap<String, i64>,
}

impl TraitForConvert for Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let materials: Materials = self.api_data.api_material.clone().into();
        let ships: Ships = self.api_data.api_ship.clone().into();
        let ndocks: NDocks = self.api_data.api_ndock.clone().into();
        let logs: Logs = self.api_data.api_log.clone().into();
        // let deck_ports: DeckPorts = self.api_data.api_deck_port.clone().into();
        let deck_ports: DeckPorts = self.api_data.clone().into();

        Some(vec![
            EmitData::Set(Set::Materials(materials)),
            EmitData::Set(Set::Ships(ships)),
            EmitData::Set(Set::NDocks(ndocks)),
            EmitData::Set(Set::Logs(logs)),
            EmitData::Set(Set::DeckPorts(deck_ports)),
            EmitData::Identifier(Identifier::Port(())),
        ])
    }
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;
    use dotenvy::dotenv;
    use std::env;

    #[test]
    fn test_deserialize() {
        let mut target_path = "./../../FUSOU-PROXY-DATA/kcsapi".to_string();

        dotenv().expect(".env file not found");
        for (key, value) in env::vars() {
            if key.eq("TEST_DATA_PATH") {
                target_path = value.clone();
            }
        }

        let pattern_str = "S@api_port@port";
        let log_path = "./src/kcapi/api_port/port@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_port@port";
        let log_path = "./src/kcapi/api_port/port@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
