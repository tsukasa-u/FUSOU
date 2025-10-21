#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_practice@battle.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_practice/battle)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use serde_json::Value;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::NumberSizeChecker;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::interface::interface::EmitData;

use crate::kcapi_common::common_air::ApiKouku;
use crate::kcapi_common::common_battle::ApiHougeki;
use crate::kcapi_common::common_battle::ApiOpeningAtack;
use crate::kcapi_common::common_battle::ApiOpeningTaisen;
use crate::kcapi_common::common_battle::ApiRaigeki;

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct Req {
    pub api_token: String,
    pub api_verno: String,
    pub api_deck_id: String,
    pub api_formation_id: String,
    pub api_enemy_id: String,
    pub api_start: Option<String>,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_practice/battle")]
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
    pub api_deck_id: i64,
    pub api_formation: Vec<i64>,
    pub api_f_nowhps: Vec<i64>,
    pub api_f_maxhps: Vec<i64>,
    #[serde(rename = "api_fParam")]
    pub api_f_param: Vec<Vec<i64>>,
    pub api_ship_ke: Vec<i64>,
    pub api_ship_lv: Vec<i64>,
    pub api_e_nowhps: Vec<i64>,
    pub api_e_maxhps: Vec<i64>,
    #[serde(rename = "api_eSlot")]
    pub api_e_slot: Vec<Vec<i64>>,
    #[serde(rename = "api_eParam")]
    pub api_e_param: Vec<Vec<i64>>,
    pub api_e_effect_list: Vec<Vec<i64>>,
    pub api_smoke_type: i64,
    pub api_balloon_cell: i64,
    pub api_atoll_cell: i64,
    pub api_midnight_flag: i64,
    pub api_search: Vec<i64>,
    pub api_stage_flag: Vec<i64>,
    pub api_kouku: ApiKouku,
    // pub api_support_flag: Value,
    // pub api_support_info: Value,
    pub api_opening_taisen_flag: i64,
    pub api_opening_taisen: Option<ApiOpeningTaisen>,
    pub api_opening_flag: i64,
    pub api_opening_atack: Option<ApiOpeningAtack>,
    pub api_hourai_flag: Vec<i64>,
    pub api_hougeki1: Option<ApiHougeki>,
    pub api_hougeki2: Option<ApiHougeki>,
    pub api_hougeki3: Value,
    pub api_raigeki: Option<ApiRaigeki>,
    pub api_flavor_info: Option<Vec<ApiFlavoInfo>>,
    pub api_injection_kouku: Option<ApiKouku>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiFlavoInfo {
    pub api_boss_ship_id: String,
    pub api_type: String,
    pub api_voice_id: String,
    pub api_class_name: String,
    pub api_ship_name: String,
    pub api_message: String,
    pub api_pos_x: String,
    pub api_pos_y: String,
    pub api_data: String,
}

// impl TraitForConvert for Res {
//     type Output = EmitData;
//     fn convert(&self) -> Option<Vec<EmitData>> {
//         let materials: Materials = self.api_data.api_material.clone().into();
//         let ships: Ships = self.api_data.api_ship.clone().into();
//         let ndocks: NDocks = self.api_data.api_ndock.clone().into();
//         let logs: Logs = self.api_data.api_log.clone().into();
//         let deck_ports: DeckPorts = self.api_data.api_deck_port.clone().into();
//         deck_ports.restore();
//         Some(vec![
//             EmitData::Set(Set::Materials(materials)),
//             EmitData::Set(Set::Ships(ships)),
//             EmitData::Set(Set::NDocks(ndocks)),
//             EmitData::Set(Set::Logs(logs)),
//             EmitData::Set(Set::DeckPorts(deck_ports))])
//     }
// }

#[cfg(test)]
mod tests {
    use dotenvy::dotenv;
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_req_practice@battle";
        let log_path = "./src/kcapi_main/api_req_practice/battle@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_practice@battle";
        let log_path = "./src/kcapi_main/api_req_practice/battle@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
