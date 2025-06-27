#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_sortie@battleresult.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_sortie/battleresult)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use std::collections::HashMap;

use crate::kcapi_common::custom_type::DuoType;

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
    pub api_l_value_0: Option<String>,
    #[serde(rename = "api_l_value[1]")]
    pub api_l_value_1: Option<String>,
    #[serde(rename = "api_l_value[2]")]
    pub api_l_value_2: Option<String>,
    #[serde(rename = "api_l_value[3]")]
    pub api_l_value_3: Option<String>,
    #[serde(rename = "api_l_value[4]")]
    pub api_l_value_4: Option<String>,
    #[serde(rename = "api_l_value[5]")]
    pub api_l_value_5: Option<String>,
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
}

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_sortie/battleresult")]
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
    #[serde(rename = "api_member_lv")]
    pub api_member_lv: i64,
    #[serde(rename = "api_member_exp")]
    pub api_member_exp: i64,
    #[serde(rename = "api_get_base_exp")]
    pub api_get_base_exp: i64,
    #[serde(rename = "api_get_ship_exp")]
    pub api_get_ship_exp: Vec<i64>,
    #[serde(rename = "api_get_exp_lvup")]
    pub api_get_exp_lvup: Vec<Vec<i64>>,
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
    #[serde(rename = "api_mapcell_incentive")]
    pub api_mapcell_incentive: i64,
    #[serde(rename = "api_get_flag")]
    pub api_get_flag: Vec<i64>,
    #[serde(rename = "api_get_eventflag")]
    pub api_get_eventflag: Option<i64>,
    #[serde(rename = "api_get_exmap_rate")]
    pub api_get_exmap_rate: Option<DuoType<i64, String>>,
    #[serde(rename = "api_get_exmap_useitem_id")]
    pub api_get_exmap_useitem_id: Option<DuoType<i64, String>>,
    #[serde(rename = "api_escape_flag")]
    pub api_escape_flag: i64,
    #[serde(rename = "api_escape")]
    pub api_escape: Option<ApiEscapeFlag>,
    #[serde(rename = "api_get_ship")]
    pub api_get_ship: Option<ApiGetShip>,
    #[serde(rename = "api_m1")]
    pub api_m1: Option<i64>,
    #[serde(rename = "api_landing_hp")]
    pub api_landing_hp: Option<ApiLandingHp>,
    #[serde(rename = "api_m_suffix")]
    pub api_m_suffix: Option<String>,
    #[serde(rename = "api_get_eventitem")]
    pub api_get_eventitem: Option<Vec<ApiGetEventitem>>,
    #[serde(rename = "api_next_map_ids")]
    pub api_next_map_ids: Option<Vec<DuoType<i64, String>>>,
    #[serde(rename = "api_select_reward_dict")]
    pub api_select_reward_dict: Option<HashMap<String, Vec<ApiSelectRewardDict>>>,
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

// #[derive(Getter, TraitForTest)]
// #[struct_test_case(field_extra, type_value, integration)]
// #[add_field(extra)]
// #[derive(Debug, Clone, Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct ApiGetEventitem {
//     #[serde(rename = "api_type")]
//     pub api_tye: i64,
//     #[serde(rename = "api_id")]
//     pub api_id: i64,
//     #[serde(rename = "api_value")]
//     pub api_value: i64,
// }

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSelectRewardDict {
    #[serde(rename = "api_item_no")]
    pub api_item_no: i64,
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_value")]
    pub api_value: i64,
}

// #[derive(Getter, TraitForTest)]
// #[struct_test_case(field_extra, type_value, integration)]
// #[add_field(extra)]
// #[derive(Debug, Clone, Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct ApiLandingHp {
//     #[serde(rename = "api_max_hp")]
//     pub api_max_hp: String,
//     #[serde(rename = "api_now_hp")]
//     pub api_now_hp: String,
//     #[serde(rename = "api_sub_value")]
//     pub api_sub_value: Option<DuoType<i64, String>>,
// }

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEscapeFlag {
    #[serde(rename = "api_escape_idx")]
    pub api_escape_idx: Vec<i64>,
    #[serde(rename = "api_escape_type")]
    pub api_escape_type: i64,
}

// #[derive(Getter, TraitForTest)]
// #[struct_test_case(field_extra, type_value, integration)]
// #[add_field(extra)]
// #[derive(Debug, Clone, Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct ApiGetShip {
//     #[serde(rename = "api_ship_id")]
//     pub api_ship_id: i64,
//     #[serde(rename = "api_ship_type")]
//     pub api_ship_type: String,
//     #[serde(rename = "api_ship_name")]
//     pub api_ship_name: String,
//     #[serde(rename = "api_ship_getmes")]
//     pub api_ship_getmes: String,
// }

// #[derive(Getter, TraitForTest)]
// #[struct_test_case(field_extra, type_value, integration)]
// #[add_field(extra)]
// #[derive(Debug, Clone, Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct ApiEnemyInfo {
//     #[serde(rename = "api_level")]
//     pub api_level: String,
//     #[serde(rename = "api_rank")]
//     pub api_rank: String,
//     #[serde(rename = "api_deck_name")]
//     pub api_deck_name: String,
// }

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_req_sortie@battleresult";
        let log_path = "./src/kcapi_main/api_req_sortie/battleresult@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_sortie@battleresult";
        let log_path = "./src/kcapi_main/api_req_sortie/battleresult@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
