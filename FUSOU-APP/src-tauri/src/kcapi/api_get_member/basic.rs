//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://tsukasa-u.github.io/FUSOU/struct_dependency_svg/api_get_member@basic.svg" alt="KC_API_dependency(api_get_member/basic)" style="max-width: 2000px;"/>
//! </div>

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::Getter;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::interface::interface::EmitData;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Req {
    #[serde(rename = "api_token")]
    pub api_token: String,
    #[serde(rename = "api_verno")]
    pub api_verno: String,
}

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_get_member/basic")]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
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
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
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

        let pattern_str = "S@api_get_member@basic";
        let log_path = "./src/kcapi/api_get_member/basic@S.log";
        simple_root_test::<Res>(target_path.clone(), pattern_str.to_string(), log_path.to_string());

        let pattern_str = "Q@api_get_member@basic";
        let log_path = "./src/kcapi/api_get_member/basic@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
