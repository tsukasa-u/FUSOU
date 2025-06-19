#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_combined_battle@battleresult.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_combined_battle/battleresult)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use std::collections::HashMap;
// use serde_json::Value;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::Getter;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::kcapi_common::common_result::ApiEnemyInfo;
use crate::kcapi_common::common_result::ApiGetEventitem;
use crate::kcapi_common::common_result::ApiGetShip;
use crate::kcapi_common::common_result::ApiLandingHp;

use crate::kcapi_common::custom_type::DuoType;

use crate::interface::interface::EmitData;

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
    #[serde(rename = "api_btime")]
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

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_combined_battle/battleresult")]
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
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: Vec<i64>,
    #[serde(rename = "api_win_rank")]
    pub api_win_rank: String,
    #[serde(rename = "api_get_exp")]
    pub api_get_exp: i64,
    #[serde(rename = "api_mvp")]
    pub api_mvp: i64,
    #[serde(rename = "api_mvp_combined")]
    pub api_mvp_combined: Option<i64>,
    #[serde(rename = "api_member_lv")]
    pub api_member_lv: i64,
    #[serde(rename = "api_member_exp")]
    pub api_member_exp: i64,
    #[serde(rename = "api_get_base_exp")]
    pub api_get_base_exp: i64,
    #[serde(rename = "api_get_ship_exp")]
    pub api_get_ship_exp: Vec<i64>,
    #[serde(rename = "api_get_ship_exp_combined")]
    pub api_get_ship_exp_combined: Option<Vec<i64>>,
    #[serde(rename = "api_get_exp_lvup")]
    pub api_get_exp_lvup: Vec<Vec<i64>>,
    #[serde(rename = "api_get_exp_lvup_combined")]
    pub api_get_exp_lvup_combined: Option<Vec<Vec<i64>>>,
    #[serde(rename = "api_dests")]
    pub api_dests: i64,
    #[serde(rename = "api_destsf")]
    pub api_destsf: i64,
    #[serde(rename = "api_quest_name")]
    pub api_quest_name: String,
    #[serde(rename = "api_quest_level")]
    pub api_quest_level: i64,
    #[serde(rename = "api_enemy_info")]
    pub api_enemy_info: ApiEnemyInfo,
    #[serde(rename = "api_first_clear")]
    pub api_first_clear: i64,
    #[serde(rename = "api_get_flag")]
    pub api_get_flag: Vec<i64>,
    #[serde(rename = "api_get_ship")]
    pub api_get_ship: Option<ApiGetShip>,
    #[serde(rename = "api_get_eventflag")]
    pub api_get_eventflag: Option<i64>,
    #[serde(rename = "api_get_exmap_rate")]
    pub api_get_exmap_rate: DuoType<i64, String>,
    #[serde(rename = "api_get_exmap_useitem_id")]
    pub api_get_exmap_useitem_id: DuoType<i64, String>,
    #[serde(rename = "api_escape_flag")]
    pub api_escape_flag: i64,
    #[serde(rename = "api_escape")]
    pub api_escape: Option<ApiEscape>,
    #[serde(rename = "api_m1")]
    pub api_m1: Option<i64>,
    #[serde(rename = "api_m_suffix")]
    pub api_m_suffix: Option<String>,
    #[serde(rename = "api_ope_suffix")]
    pub api_ope_suffix: Option<String>,
    #[serde(rename = "api_next_map_ids")]
    pub api_next_map_ids: Option<Vec<String>>,
    #[serde(rename = "api_landing_hp")]
    pub api_landing_hp: Option<ApiLandingHp>,
    #[serde(rename = "api_get_eventitem")]
    pub api_get_eventitem: Option<Vec<ApiGetEventitem>>,
    #[serde(rename = "api_select_reward_dict")]
    pub api_select_reward_dict: Option<HashMap<String, Vec<ApiSelectReward>>>,
    #[serde(rename = "api_get_useitem")]
    pub api_get_useitem: Option<ApiGetUseitem>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiGetUseitem {
    #[serde(rename = "api_useitem_id")]
    pub api_useitem_id: i64,
    #[serde(rename = "api_useitem_name")]
    pub api_useitem_name: String,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSelectReward {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_value")]
    pub api_value: i64,
    #[serde(rename = "api_item_no")]
    pub api_item_no: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEscape {
    #[serde(rename = "api_escape_idx")]
    pub api_escape_idx: Vec<i64>,
    #[serde(rename = "api_tow_idx")]
    pub api_tow_idx: Vec<i64>,
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
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
