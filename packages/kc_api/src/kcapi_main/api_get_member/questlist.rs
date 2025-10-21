#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_get_member@questlist.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/questlist)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;

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
    pub api_tab_id: String,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_get_member/questlist")]
#[derive(Debug, Clone, Deserialize)]
pub struct Res {
    pub api_result: Option<i64>,
    pub api_result_msg: String,
    pub api_data: ApiData,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiData {
    pub api_count: i64,
    pub api_completed_kind: i64,
    pub api_list: Option<Vec<ApiList>>,
    pub api_exec_count: i64,
    pub api_exec_type: i64,
    pub api_c_list: Option<Vec<ApiCList>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiCList {
    pub api_no: i64,
    pub api_state: i64,
    pub api_progress_flag: i64,
    pub api_c_flag: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiList {
    pub api_no: i64,
    pub api_category: i64,
    pub api_type: i64,
    pub api_label_type: i64,
    pub api_state: i64,
    pub api_title: String,
    pub api_detail: String,
    pub api_voice_id: i64,
    pub api_get_material: Vec<i64>,
    pub api_bonus_flag: i64,
    pub api_progress_flag: i64,
    pub api_invalid_flag: i64,
    pub api_lost_badges: Option<i64>,
    pub api_select_rewards: Option<Vec<Vec<ApiSelectRewards>>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSelectRewards {
    pub api_no: i64,
    pub api_kind: i64,
    pub api_mst_id: i64,
    pub api_count: i64,
    pub api_slotitem_level: Option<i64>,
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

        let pattern_str = "S@api_get_member@questlist";
        let log_path = "./src/kcapi_main/api_get_member/questlist@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@questlist";
        let log_path = "./src/kcapi_main/api_get_member/questlist@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
