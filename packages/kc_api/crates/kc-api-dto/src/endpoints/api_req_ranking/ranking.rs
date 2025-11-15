#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_req_ranking@ranking.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_ranking/ranking)")]
#![doc = include_str!("../../../../../js/svg_pan_zoom.html")]

use serde::{Deserialize, Serialize};

use register_trait::{add_field, register_struct};
use register_trait::{FieldSizeChecker, QueryWithExtra, TraitForRoot, TraitForTest};

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_for_qs)]
#[derive(Debug, Clone, QueryWithExtra)]
pub struct Req {
    #[qs(rename = "api_token")]
    pub api_token: String,
    #[qs(rename = "api_verno")]
    pub api_verno: i64,
    #[qs(rename = "api_pageno")]
    pub api_pageno: Option<i64>,
    #[qs(rename = "api_ranking")]
    pub api_ranking: String,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[register_struct(name = "api_req_ranking/mxltvkpyuklh")]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Res {
    #[serde(rename = "api_result")]
    pub api_result: i64,
    #[serde(rename = "api_result_msg")]
    pub api_result_msg: String,
    #[serde(rename = "api_data")]
    pub api_data: ApiData,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
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

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
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
    use crate::test_utils::struct_normalize::{FormatType, custom_match_normalize};
    use dotenvy::dotenv;
    use regex::Regex;
    use register_trait::custom_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let target = path::PathBuf::from(target_path);
        let files = target.read_dir().expect("read_dir call failed");
        let file_list = files
            .map(|dir_entry| {
                dir_entry.unwrap().path()
            }).collect::<Vec<_>>();

        let pattern_str = Regex::new(r".*S@api_req_ranking@[a-z]*").unwrap();
        let log_path = "./src/endpoints/api_req_ranking/ranking@S.log";
        let binding = file_list.clone();
        let res_file_list = binding.iter()
            .filter(|file_path| pattern_str.is_match(file_path.to_str().unwrap())).map(|file_path| file_path.to_owned());
        println!("{}",res_file_list.clone().count());
        custom_root_test::<Res>(res_file_list, log_path.to_string());

        let pattern_str = Regex::new(r".*Q@api_req_ranking@[a-z]*").unwrap();
        let log_path = "./src/endpoints/api_req_ranking/ranking@Q.log";
        let binding = file_list.clone();
        let req_file_list = binding.iter()
            .filter(|file_path| pattern_str.is_match(file_path.to_str().unwrap())).map(|file_path| file_path.to_owned());
        custom_root_test::<Req>(req_file_list, log_path.to_string());
    }

    #[test]
    fn test_organize_test_data() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");
        let snap_file_path = std::env::var("TEST_DATA_REPO_PATH").expect("failed to get env data");

        let req_and_res_pattern_str = "@api_req_ranking@ranking";
        let snap_path = format!("{snap_file_path}/kcsapi");


        let target = path::PathBuf::from(target_path);
        let files = target.read_dir().expect("read_dir call failed");
        let file_list = files
            .map(|dir_entry| {
                dir_entry.unwrap().path()
            }).collect::<Vec<_>>();

        let snap_target = path::PathBuf::from(snap_path);
        let snap_files = snap_target.read_dir().expect("read_dir call failed");
        let snap_file_list = snap_files
            .map(|dir_entry| {
                dir_entry.unwrap().path()
            }).filter(|file_path| file_path.to_str().unwrap().contains(req_and_res_pattern_str))
            .collect::<Vec<_>>();

        let pattern_str = Regex::new(r".*S@api_req_ranking@[a-z]*").unwrap();
        let res_log_path = "./src/endpoints/api_req_ranking/ranking@snap_data@S.log";
        let binding = file_list.clone();
        let res_file_list = binding.iter()
            .filter(|file_path| pattern_str.is_match(file_path.to_str().unwrap())).map(|file_path| file_path.to_owned());
        let snap_res_file_list = snap_file_list.iter()
            .filter(|file_path| pattern_str.is_match(file_path.to_str().unwrap())).map(|file_path| file_path.to_owned());


        let pattern_str = Regex::new(r".*Q@api_req_ranking@[a-z]*").unwrap();
        let req_log_path = "./src/endpoints/api_req_ranking/ranking@snap_data@Q.log";
        let binding = file_list.clone();
        let req_file_list = binding.iter()
            .filter(|file_path| pattern_str.is_match(file_path.to_str().unwrap())).map(|file_path| file_path.to_owned());
        let snap_req_file_list = snap_file_list.iter()
            .filter(|file_path| pattern_str.is_match(file_path.to_str().unwrap())).map(|file_path| file_path.to_owned());

        let mask_patterns = Some(vec![
            r"req\.api_ranking",
            r"res\.api_data\.api_list\.api_mtjmdcwtvhdr",
            r"res\.api_data\.api_list\.api_itbrdpdbkynm",
            r"res\.api_data\.api_list\.api_itslcqtmrxtf",
            r"res\.api_data\.api_list\.api_wuhnhojjxmke",
        ]);
        custom_match_normalize::<Req, Res>(
            res_file_list.clone().into_iter(),
            req_file_list.clone().into_iter(),
            snap_res_file_list.into_iter(),
            snap_file_path.clone(),
            FormatType::Json,
            res_log_path.to_string(),
            mask_patterns.clone().unwrap_or_default(),
        );

        custom_match_normalize::<Req, Res>(
            req_file_list.into_iter(),
            res_file_list.into_iter(),
            snap_req_file_list.into_iter(),
            snap_file_path,
            FormatType::QueryString,
            req_log_path.to_string(),
            mask_patterns.unwrap_or_default(),
        );
    }
}
