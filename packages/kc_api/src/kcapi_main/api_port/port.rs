#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_port@port.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_port/port)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

use register_trait::{add_field, register_struct};

use register_trait::{NumberSizeChecker, TraitForConvert, TraitForRoot, TraitForTest};

use crate::interface::deck_port::DeckPorts;
use crate::interface::interface::{EmitData, Identifier, Set};
use crate::interface::logs::Logs;
use crate::interface::material::Materials;
use crate::interface::n_dock::NDocks;
use crate::interface::ship::Ships;

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct Req {
    pub api_token: String,
    pub api_verno: String,
    pub api_port: String,
    pub api_sort_key: String,
    #[serde(rename = "spi_sort_order")]
    pub api_sort_order: String,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_port/port")]
#[derive(Debug, Clone, Deserialize)]
pub struct Res {
    pub api_result: i64,
    pub api_result_msg: String,
    pub api_data: ApiData,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiData {
    pub api_event_object: Option<ApiEventObject>,
    pub api_material: Vec<ApiMaterial>,
    pub api_deck_port: Vec<ApiDeckPort>,
    pub api_ndock: Vec<ApiNdock>,
    pub api_ship: Vec<ApiShip>,
    pub api_basic: ApiBasic,
    pub api_log: Vec<ApiLog>,
    pub api_combined_flag: Option<i64>,
    pub api_p_bgm_id: i64,
    pub api_furniture_affect_items: ApiFurnitureAffectItems,
    pub api_parallel_quest_count: i64,
    pub api_dest_ship_slot: i64,
    pub api_c_flags: Option<Vec<i64>>,
    pub api_friendly_setting: Option<ApiFriendlySetting>,
    pub api_plane_info: Option<ApiPlaneInfo>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiPlaneInfo {
    pub api_base_convert_slot: Option<Vec<i64>>,
    pub api_unset_slot: Option<Vec<ApiUnsetSlot>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiUnsetSlot {
    #[serde(rename = "api_type3No")]
    api_type3_no: i64,
    api_slot_list: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiFriendlySetting {
    api_request_flag: i64,
    api_request_type: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiEventObject {
    pub api_c_num: Option<i64>,
    pub api_m_flag: Option<i64>,
    pub api_m_flag2: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiMaterial {
    pub api_member_id: i64,
    pub api_id: i64,
    pub api_value: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiDeckPort {
    pub api_member_id: i64,
    pub api_id: i64,
    pub api_name: String,
    pub api_name_id: String,
    pub api_mission: Vec<i64>,
    pub api_flagship: String,
    pub api_ship: Vec<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiNdock {
    pub api_member_id: i64,
    pub api_id: i64,
    pub api_state: i64,
    pub api_ship_id: i64,
    pub api_complete_time: i64,
    pub api_complete_time_str: String,
    pub api_item1: i64,
    pub api_item2: i64,
    pub api_item3: i64,
    pub api_item4: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiShip {
    pub api_id: i64,
    pub api_sortno: i64,
    pub api_ship_id: i64,
    pub api_lv: i64,
    pub api_exp: Vec<i64>,
    pub api_nowhp: i64,
    pub api_maxhp: i64,
    pub api_soku: i64,
    pub api_leng: i64,
    pub api_slot: Vec<i64>,
    pub api_onslot: Vec<i64>,
    pub api_slot_ex: i64,
    pub api_kyouka: Vec<i64>,
    pub api_backs: i64,
    pub api_fuel: i64,
    pub api_bull: i64,
    pub api_slotnum: i64,
    pub api_ndock_time: i64,
    pub api_ndock_item: Vec<i64>,
    pub api_srate: i64,
    pub api_cond: i64,
    pub api_karyoku: Vec<i64>,
    pub api_raisou: Vec<i64>,
    pub api_taiku: Vec<i64>,
    pub api_soukou: Vec<i64>,
    pub api_kaihi: Vec<i64>,
    pub api_taisen: Vec<i64>,
    pub api_sakuteki: Vec<i64>,
    pub api_lucky: Vec<i64>,
    pub api_locked: i64,
    pub api_locked_equip: i64,
    pub api_sally_area: Option<i64>,
    pub api_sp_effect_items: Option<Vec<ApiSpEffectItem>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSpEffectItem {
    pub api_kind: i64,
    pub api_raig: Option<i64>,
    pub api_souk: Option<i64>,
    pub api_houg: Option<i64>,
    pub api_kaih: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiBasic {
    pub api_member_id: String,
    pub api_nickname: String,
    pub api_nickname_id: String,
    pub api_active_flag: i64,
    pub api_starttime: i64,
    pub api_level: i64,
    pub api_rank: i64,
    pub api_experience: i64,
    pub api_fleetname: Value,
    pub api_comment: String,
    pub api_comment_id: String,
    pub api_max_chara: i64,
    pub api_max_slotitem: i64,
    pub api_max_kagu: i64,
    pub api_playtime: i64,
    pub api_tutorial: i64,
    pub api_furniture: Vec<i64>,
    pub api_count_deck: i64,
    pub api_count_kdock: i64,
    pub api_count_ndock: i64,
    pub api_fcoin: i64,
    pub api_st_win: i64,
    pub api_st_lose: i64,
    pub api_ms_count: i64,
    pub api_ms_success: i64,
    pub api_pt_win: i64,
    pub api_pt_lose: i64,
    pub api_pt_challenged: i64,
    pub api_pt_challenged_win: i64,
    pub api_firstflag: i64,
    pub api_tutorial_progress: i64,
    pub api_pvp: Vec<i64>,
    pub api_medals: i64,
    pub api_large_dock: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiLog {
    pub api_no: i64,
    pub api_type: String,
    pub api_state: String,
    pub api_message: String,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiFurnitureAffectItems {
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
    use dotenvy::dotenv;
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_port@port";
        let log_path = "./src/kcapi_main/api_port/port@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_port@port";
        let log_path = "./src/kcapi_main/api_port/port@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
