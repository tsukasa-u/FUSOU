//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://tsukasa-u.github.io/FUSOU/struct_dependency_svg/api_get_member@picture_book.svg" alt="KC_API_dependency(api_get_member/picture_book)" style="max-width: 2000px;"/>
//! </div>

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
// use serde_json::Value;
use crate::kcapi_common::custom_type::DuoType;

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
#[register_struct(name = "api_get_member/picture_book")]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
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
    #[serde(rename = "api_list")]
    pub api_list: Vec<ApiList>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiList {
    #[serde(rename = "api_index_no")]
    pub api_index_no: i64,
    #[serde(rename = "api_state")]
    pub api_state: Vec<DuoType<i64, Vec<i64>>>,
    #[serde(rename = "api_table_id")]
    pub api_table_id: Vec<i64>,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_type")]
    pub api_type: Option<Vec<i64>>,
    #[serde(rename = "api_souk")]
    pub api_souk: i64,
    #[serde(rename = "api_houg")]
    pub api_houg: i64,
    #[serde(rename = "api_raig")]
    pub api_raig: i64,
    #[serde(rename = "api_soku")]
    pub api_soku: Option<i64>,
    #[serde(rename = "api_baku")]
    pub api_baku: Option<i64>,
    #[serde(rename = "api_tyku")]
    pub api_tyku: i64,
    #[serde(rename = "api_tais")]
    pub api_tais: i64,
    #[serde(rename = "api_houm")]
    pub api_houm: Option<i64>,
    #[serde(rename = "api_houk")]
    pub api_houk: Option<i64>,
    #[serde(rename = "api_saku")]
    pub api_saku: Option<i64>,
    #[serde(rename = "api_leng")]
    pub api_leng: i64,
    #[serde(rename = "api_flag")]
    pub api_flag: Option<Vec<i64>>,
    #[serde(rename = "api_info")]
    pub api_info: Option<String>,
    #[serde(rename = "api_cnum")]
    pub api_cnum: Option<i64>,
    #[serde(rename = "api_taik")]
    pub api_taik: Option<i64>,
    #[serde(rename = "api_kaih")]
    pub api_kaih: Option<i64>,
    #[serde(rename = "api_sinfo")]
    pub api_sinfo: Option<String>,
    #[serde(rename = "api_stype")]
    pub api_stype: Option<i64>,
    #[serde(rename = "api_ctype")]
    pub api_ctype: Option<i64>,
    #[serde(rename = "api_yomi")]
    pub api_yomi: Option<String>,
    #[serde(rename = "api_q_voice_info")]
    pub api_q_voice_info: Option<Vec<QVoiceInfo>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QVoiceInfo {
    #[serde(rename = "api_no")]
    pub api_no: i64,
    #[serde(rename = "api_voice_id")]
    pub api_voice_id: i64,
    #[serde(rename = "api_icon_id")]
    pub api_icon_id: i64,
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

        let pattern_str = "S@api_get_member@picture_book";
        let log_path = "./src/kcapi/api_get_member/picture_book.log";
        simple_root_test::<Root>(
            target_path.to_string(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
