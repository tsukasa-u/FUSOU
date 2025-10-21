#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_combined_battle@battleresult.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_combined_battle/battleresult)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use std::collections::HashMap;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::NumberSizeChecker;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::kcapi_common::common_result::ApiEnemyInfo;
use crate::kcapi_common::common_result::ApiGetEventitem;
use crate::kcapi_common::common_result::ApiGetShip;
use crate::kcapi_common::common_result::ApiLandingHp;

use crate::kcapi_common::custom_type::DuoType;

use crate::interface::interface::EmitData;

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct Req {
    pub api_token: String,
    pub api_verno: String,
    pub api_btime: String,
    #[serde(rename = "api_l_value[0]")]
    pub api_l_value_0: String,
    #[serde(rename = "api_l_value[1]")]
    pub api_l_value_1: String,
    #[serde(rename = "api_l_value[2]")]
    pub api_l_value_2: String,
    #[serde(rename = "api_l_value[3]")]
    pub api_l_value_3: String,
    #[serde(rename = "api_l_value[4]")]
    pub api_l_value_4: String,
    #[serde(rename = "api_l_value[5]")]
    pub api_l_value_5: String,
    #[serde(rename = "api_l_value2[0]")]
    pub api_l_value2_0: Option<String>,
    #[serde(rename = "api_l_value2[1]")]
    pub api_l_value2_1: Option<String>,
    #[serde(rename = "api_l_value2[2]")]
    pub api_l_value2_2: Option<String>,
    #[serde(rename = "api_l_value2[3]")]
    pub api_l_value2_3: Option<String>,
    #[serde(rename = "api_l_value2[4]")]
    pub api_l_value2_4: Option<String>,
    #[serde(rename = "api_l_value2[5]")]
    pub api_l_value2_5: Option<String>,
    #[serde(rename = "api_l_value3[0]")]
    pub api_l_value3_0: Option<String>,
    #[serde(rename = "api_l_value3[1]")]
    pub api_l_value3_1: Option<String>,
    #[serde(rename = "api_l_value3[2]")]
    pub api_l_value3_2: Option<String>,
    #[serde(rename = "api_l_value3[3]")]
    pub api_l_value3_3: Option<String>,
    #[serde(rename = "api_l_value3[4]")]
    pub api_l_value3_4: Option<String>,
    #[serde(rename = "api_l_value3[5]")]
    pub api_l_value3_5: Option<String>,
    #[serde(rename = "api_l_value4[0]")]
    pub api_l_value4_0: Option<String>,
    #[serde(rename = "api_l_value4[1]")]
    pub api_l_value4_1: Option<String>,
    #[serde(rename = "api_l_value4[2]")]
    pub api_l_value4_2: Option<String>,
    #[serde(rename = "api_l_value4[3]")]
    pub api_l_value4_3: Option<String>,
    #[serde(rename = "api_l_value4[4]")]
    pub api_l_value4_4: Option<String>,
    #[serde(rename = "api_l_value4[5]")]
    pub api_l_value4_5: Option<String>,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_combined_battle/battleresult")]
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
    pub api_win_rank: String,
    pub api_get_exp: i64,
    pub api_mvp: i64,
    pub api_mvp_combined: Option<i64>,
    pub api_member_lv: i64,
    pub api_member_exp: i64,
    pub api_get_base_exp: i64,
    pub api_get_ship_exp: Vec<i64>,
    pub api_get_ship_exp_combined: Option<Vec<i64>>,
    pub api_get_exp_lvup: Vec<Vec<i64>>,
    pub api_get_exp_lvup_combined: Option<Vec<Vec<i64>>>,
    pub api_dests: i64,
    pub api_destsf: i64,
    pub api_quest_name: String,
    pub api_quest_level: i64,
    pub api_enemy_info: ApiEnemyInfo,
    pub api_first_clear: i64,
    pub api_get_flag: Vec<i64>,
    pub api_get_ship: Option<ApiGetShip>,
    pub api_get_eventflag: Option<i64>,
    pub api_get_exmap_rate: DuoType<i64, String>,
    pub api_get_exmap_useitem_id: DuoType<i64, String>,
    pub api_escape_flag: i64,
    pub api_escape: Option<ApiEscape>,
    pub api_m1: Option<i64>,
    pub api_m_suffix: Option<String>,
    pub api_ope_suffix: Option<String>,
    pub api_next_map_ids: Option<Vec<String>>,
    pub api_landing_hp: Option<ApiLandingHp>,
    pub api_get_eventitem: Option<Vec<ApiGetEventitem>>,
    pub api_select_reward_dict: Option<HashMap<String, Vec<ApiSelectReward>>>,
    pub api_get_useitem: Option<ApiGetUseitem>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiGetUseitem {
    pub api_useitem_id: i64,
    pub api_useitem_name: String,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSelectReward {
    pub api_id: i64,
    pub api_type: i64,
    pub api_value: i64,
    pub api_item_no: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiEscape {
    pub api_escape_idx: Vec<i64>,
    pub api_tow_idx: Vec<i64>,
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

        let pattern_str = "S@api_req_combined_battle@battleresult";
        let log_path = "./src/kcapi_main/api_req_combined_battle/battleresult@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_combined_battle@battleresult";
        let log_path = "./src/kcapi_main/api_req_combined_battle/battleresult@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
