//! # kanColle API
//! KC APIs are also dependent on kcapi::kcapi_common.
//! The dependency graph of the APIs is shown below.
//! <div style="height: 80vh; overflow: scroll;">
//!   <img src="https://tsukasa-u.github.io/FUSOU/struct_dependency_svg/api_req_ranking@ranking.svg" alt="KC_API_dependency(api_req_ranking/ranking)" style="max-width: 2000px;"/>
//! </div>

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
// use serde_json::Value;

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
pub struct Req {}

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_ranking/mxltvkpyuklh")]
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
    #[serde(rename = "api_count")]
    pub api_count: i64,
    #[serde(rename = "api_page_count")]
    pub api_page_count: i64,
    #[serde(rename = "api_disp_page")]
    pub api_disp_page: i64,
    #[serde(rename = "api_list")]
    pub api_list: Vec<ApiList>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiList {
    #[serde(rename = "api_mxltvkpyuklh")]
    pub api_mxltvkpyuklh: i64,
    #[serde(rename = "api_mtjmdcwtvhdr")]
    pub api_mtjmdcwtvhdr: String,
    #[serde(rename = "api_pbgkfylkbjuy")]
    pub api_pbgkfylkbjuy: i64,
    #[serde(rename = "api_pcumlrymlujh")]
    pub api_pcumlrymlujh: i64,
    #[serde(rename = "api_itbrdpdbkynm")]
    pub api_itbrdpdbkynm: String,
    #[serde(rename = "api_itslcqtmrxtf")]
    pub api_itslcqtmrxtf: i64,
    #[serde(rename = "api_wuhnhojjxmke")]
    pub api_wuhnhojjxmke: i64,
}

#[cfg(test)]
mod tests {
    use std::path;

    use regex::Regex;
    use register_trait::custom_root_test;

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

        let pattern_str = Regex::new(r".*S@api_req_ranking@[a-z]*").unwrap();
        let log_path = "./src/kcapi/api_req_ranking/ranking.log";

        let target = path::PathBuf::from(target_path);
        let files = target.read_dir().expect("read_dir call failed");
        let file_list = files
            .map(|dir_entry| {
                let file_path = dir_entry.unwrap().path();
                // file_path.exists();
                return file_path;
            })
            .filter(|file_path| pattern_str.is_match(file_path.to_str().unwrap()));
        custom_root_test::<Res>(file_list, log_path.to_string());
    }
}
