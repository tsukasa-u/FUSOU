#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="../../tests/struct_dependency_svg/api_get_member@practice.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/practice)")]
#![doc = include_str!("../../../../../js/svg_pan_zoom.html")]

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
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]

#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_get_member/practice")]
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
    #[serde(rename = "api_create_kind")]
    pub api_create_kind: i64,
    #[serde(rename = "api_selected_kind")]
    pub api_selected_kind: i64,
    #[serde(rename = "api_entry_limit")]
    pub api_entry_limit: Option<i64>,
    #[serde(rename = "api_list")]
    pub api_list: Vec<ApiList>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiList {
    #[serde(rename = "api_enemy_id")]
    pub api_enemy_id: i64,
    #[serde(rename = "api_enemy_name")]
    pub api_enemy_name: String,
    #[serde(rename = "api_enemy_name_id")]
    pub api_enemy_name_id: String,
    #[serde(rename = "api_enemy_level")]
    pub api_enemy_level: i64,
    #[serde(rename = "api_enemy_rank")]
    pub api_enemy_rank: String,
    #[serde(rename = "api_enemy_flag")]
    pub api_enemy_flag: i64,
    #[serde(rename = "api_enemy_flag_ship")]
    pub api_enemy_flag_ship: i64,
    #[serde(rename = "api_enemy_comment")]
    pub api_enemy_comment: String,
    #[serde(rename = "api_enemy_comment_id")]
    pub api_enemy_comment_id: String,
    #[serde(rename = "api_state")]
    pub api_state: i64,
    #[serde(rename = "api_medals")]
    pub api_medals: i64,
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

        let pattern_str = "S@api_get_member@practice";
        let log_path = "./src/endpoints/api_get_member/practice@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@practice";
        let log_path = "./src/endpoints/api_get_member/practice@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
