#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_get_member@picture_book.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/picture_book)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use crate::kcapi_common::custom_type::DuoType;
use serde::Deserialize;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::NumberSizeChecker;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::interface::interface::EmitData;

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct Req {
    pub api_token: String,
    pub api_verno: String,
    pub api_no: String,
    pub api_type: String,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_get_member/picture_book")]
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
    pub api_list: Vec<ApiList>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiList {
    pub api_index_no: i64,
    pub api_state: Vec<DuoType<i64, Vec<i64>>>,
    pub api_table_id: Vec<i64>,
    pub api_name: String,
    pub api_type: Option<Vec<i64>>,
    pub api_souk: i64,
    pub api_houg: i64,
    pub api_raig: i64,
    pub api_soku: Option<i64>,
    pub api_baku: Option<i64>,
    pub api_tyku: i64,
    pub api_tais: i64,
    pub api_houm: Option<i64>,
    pub api_houk: Option<i64>,
    pub api_saku: Option<i64>,
    pub api_leng: i64,
    pub api_flag: Option<Vec<i64>>,
    pub api_info: Option<String>,
    pub api_cnum: Option<i64>,
    pub api_taik: Option<i64>,
    pub api_kaih: Option<i64>,
    pub api_sinfo: Option<String>,
    pub api_stype: Option<i64>,
    pub api_ctype: Option<i64>,
    pub api_yomi: Option<String>,
    pub api_q_voice_info: Option<Vec<QVoiceInfo>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct QVoiceInfo {
    pub api_no: i64,
    pub api_voice_id: i64,
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
