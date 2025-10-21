#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_combined_battle@each_battle.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_combined_battle/each_battle)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::NumberSizeChecker;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::kcapi_common::common_air::ApiAirBaseAttack;
use crate::kcapi_common::common_air::ApiAirBaseInjection;
use crate::kcapi_common::common_air::ApiKouku;
use crate::kcapi_common::common_battle::ApiFlavorInfo;
use crate::kcapi_common::common_battle::ApiHougeki;
use crate::kcapi_common::common_battle::ApiOpeningAtack;
use crate::kcapi_common::common_battle::ApiOpeningTaisen;
use crate::kcapi_common::common_battle::ApiRaigeki;
use crate::kcapi_common::common_battle::ApiSupportInfo;

use crate::interface::interface::EmitData;

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct Req {
    pub api_token: String,
    pub api_verno: String,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_combined_battle/each_battle")]
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
    pub api_f_nowhps_combined: Vec<i64>,
    pub api_f_maxhps_combined: Vec<i64>,
    #[serde(rename = "api_fParam")]
    pub api_f_param: Vec<Vec<i64>>,
    #[serde(rename = "api_fParam_combined")]
    pub api_f_param_combined: Vec<Vec<i64>>,
    pub api_ship_ke: Vec<i64>,
    pub api_ship_lv: Vec<i64>,
    pub api_ship_ke_combined: Vec<i64>,
    pub api_ship_lv_combined: Vec<i64>,
    pub api_e_nowhps: Vec<i64>,
    pub api_e_maxhps: Vec<i64>,
    pub api_e_nowhps_combined: Vec<i64>,
    pub api_e_maxhps_combined: Vec<i64>,
    #[serde(rename = "api_eSlot")]
    pub api_e_slot: Vec<Vec<i64>>,
    #[serde(rename = "api_eSlot_combined")]
    pub api_e_slot_combined: Vec<Vec<i64>>,
    #[serde(rename = "api_eParam")]
    pub api_e_param: Vec<Vec<i64>>,
    #[serde(rename = "api_eParam_combined")]
    pub api_e_param_combined: Vec<Vec<i64>>,
    pub api_flavor_info: Vec<ApiFlavorInfo>,
    pub api_smoke_type: i64,
    pub api_balloon_cell: i64,
    pub api_atoll_cell: i64,
    pub api_midnight_flag: i64,
    pub api_search: Vec<i64>,
    pub api_air_base_attack: Option<Vec<ApiAirBaseAttack>>,
    pub api_stage_flag: Vec<i64>,
    pub api_kouku: ApiKouku,
    pub api_support_flag: i64,
    pub api_support_info: Option<ApiSupportInfo>,
    pub api_opening_taisen_flag: i64,
    pub api_opening_taisen: Option<ApiOpeningTaisen>,
    pub api_opening_flag: i64,
    pub api_opening_atack: ApiOpeningAtack,
    pub api_hourai_flag: Vec<i64>,
    pub api_hougeki1: ApiHougeki,
    pub api_raigeki: ApiRaigeki,
    pub api_hougeki2: Option<ApiHougeki>,
    pub api_hougeki3: Option<ApiHougeki>,
    pub api_injection_kouku: Option<ApiKouku>,
    pub api_air_base_injection: Option<ApiAirBaseInjection>,
    pub api_escape_idx: Option<Vec<i64>>,
    pub api_escape_idx_combined: Option<Vec<i64>>,
    pub api_combat_ration: Option<Vec<i64>>,
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

        let pattern_str = "S@api_req_combined_battle@each_battle";
        let log_path = "./src/kcapi_main/api_req_combined_battle/each_battle@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_combined_battle@each_battle";
        let log_path = "./src/kcapi_main/api_req_combined_battle/each_battle@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
