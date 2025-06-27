#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_ranking@ranking.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_ranking/ranking)")]
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
}

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_ranking/mxltvkpyuklh")]
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
#[derive(Debug, Clone, Deserialize)]
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
    #[test]
    fn test_deserialize() {
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = Regex::new(r".*S@api_req_ranking@[a-z]*").unwrap();
        let log_path = "./src/kcapi_main/api_req_ranking/ranking@S.log";

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
