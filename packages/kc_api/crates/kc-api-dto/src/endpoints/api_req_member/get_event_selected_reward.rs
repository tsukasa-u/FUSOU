#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_req_member@get_event_selected_reward.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_member/get_event_selected_reward)")]
#![doc = include_str!("../../../../../js/svg_pan_zoom.html")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    #[qs(rename = "api_selected_dict")]
    pub api_selected_dict_221: Option<HashMap<i64, i64>>,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[register_struct(name = "api_req_member/get_event_selected_reward")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Res {
    #[serde(rename = "api_data")]
    pub api_data: ApiData,
    #[serde(rename = "api_result")]
    pub api_result: i64,
    #[serde(rename = "api_result_msg")]
    pub api_result_msg: String,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_get_item_list")]
    pub api_get_item_list: Vec<ApiGetItemList>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra_with_flatten)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiGetItemList {
    #[serde(rename = "api_item_no")]
    pub api_item_no: i64,
    #[serde(rename = "api_type")]
    pub api_type: i64,
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_value")]
    pub api_value: i64,
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

        let pattern_str = "S@api_req_member@get_event_selected_reward";
        let log_path = "./src/endpoints/api_req_member/get_event_selected_reward@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_member@get_event_selected_reward";
        let log_path = "./src/endpoints/api_req_member/get_event_selected_reward@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
