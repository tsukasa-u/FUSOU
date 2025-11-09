#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_get_member@payitem.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/payitem)")]
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
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[register_struct(name = "api_get_member/payitem")]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Res {
    #[serde(rename = "api_result")]
    pub api_result: i64,
    #[serde(rename = "api_result_msg")]
    pub api_result_msg: String,
    #[serde(rename = "api_data")]
    pub api_data: Vec<ApiData>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_payitem_id")]
    pub api_payitem_id: String,
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_name")]
    pub api_name: String,
    #[serde(rename = "api_description")]
    pub api_description: String,
    #[serde(rename = "api_price")]
    pub api_price: i64,
    #[serde(rename = "api_count")]
    pub api_count: i64,
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

        let pattern_str = "S@api_get_member@payitem";
        let log_path = "./src/endpoints/api_get_member/payitem@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@payitem";
        let log_path = "./src/endpoints/api_get_member/payitem@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
