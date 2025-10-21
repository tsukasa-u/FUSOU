#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_mission@result.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_mission/result)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;

use crate::kcapi_common::custom_type::DuoType;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::NumberSizeChecker;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::interface::interface::EmitData;

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct Req {
    pub api_token: String,
    pub api_verno: String,
    pub api_deck_id: String,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_mission/result")]
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
    pub api_ship_id: Vec<i64>,
    pub api_clear_result: i64,
    pub api_get_exp: i64,
    pub api_member_lv: i64,
    pub api_member_exp: i64,
    pub api_get_ship_exp: Vec<i64>,
    pub api_get_exp_lvup: Vec<Vec<i64>>,
    pub api_maparea_name: String,
    pub api_detail: String,
    pub api_quest_name: String,
    pub api_quest_level: i64,
    pub api_get_material: Option<DuoType<Vec<i64>, i64>>,
    pub api_useitem_flag: Vec<i64>,
    pub api_get_item1: Option<ApiGetItem>,
    pub api_get_item2: Option<ApiGetItem>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiGetItem {
    pub api_useitem_id: i64,
    pub api_useitem_name: Option<String>,
    pub api_useitem_count: i64,
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

        let pattern_str = "S@api_req_mission@result";
        let log_path = "./src/kcapi_main/api_req_mission/result@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_mission@result";
        let log_path = "./src/kcapi_main/api_req_mission/result@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
