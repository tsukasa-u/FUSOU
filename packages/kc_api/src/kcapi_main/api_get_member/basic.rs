#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_get_member@basic.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/basic)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use serde_json::Value;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::{NumberSizeChecker, TraitForConvert, TraitForRoot, TraitForTest};

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
#[register_struct(name = "api_get_member/basic")]
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

        let pattern_str = "S@api_get_member@basic";
        let log_path = "./src/kcapi_main/api_get_member/basic@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@basic";
        let log_path = "./src/kcapi_main/api_get_member/basic@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
