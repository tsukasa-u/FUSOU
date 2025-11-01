#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_get_member@picture_book.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/picture_book)")]
#![doc = include_str!("../../../../../js/svg_pan_zoom.html")]

use crate::common::custom_type::DuoType;
use serde::Deserialize;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::FieldSizeChecker;

use register_trait::TraitForRoot;
use register_trait::TraitForTest;



#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]

#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Req {
    #[serde(rename = "api_token")]
    pub api_token: String,
    #[serde(rename = "api_verno")]
    pub api_verno: String,
    #[serde(rename = "api_no")]
    pub api_no: String,
    #[serde(rename = "api_type")]
    pub api_type: String,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]

#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_get_member/picture_book")]
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

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_list")]
    pub api_list: Vec<ApiList>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
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

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
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
    use dotenvy::dotenv;
    use register_trait::simple_root_test;

    use super::*;
    #[test]
    fn test_deserialize() {
        dotenv().expect(".env file not found");
        let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

        let pattern_str = "S@api_get_member@picture_book";
        let log_path = "./src/kcapi_main/api_get_member/picture_book@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@picture_book";
        let log_path = "./src/kcapi_main/api_get_member/picture_book@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
