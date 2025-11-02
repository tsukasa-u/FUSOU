#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_member@get_practice_enemyinfo.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_member/get_practice_enemyinfo)")]
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
    #[serde(rename = "api_member_id")]
    pub api_member_id: String,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot)]

#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_member/get_practice_enemyinfo")]
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
    #[serde(rename = "api_member_id")]
    pub api_member_id: i64,
    #[serde(rename = "api_nickname")]
    pub api_nickname: String,
    #[serde(rename = "api_nickname_id")]
    pub api_nickname_id: String,
    #[serde(rename = "api_cmt")]
    pub api_cmt: String,
    #[serde(rename = "api_cmt_id")]
    pub api_cmt_id: String,
    #[serde(rename = "api_level")]
    pub api_level: i64,
    #[serde(rename = "api_rank")]
    pub api_rank: i64,
    #[serde(rename = "api_experience")]
    pub api_experience: Vec<i64>,
    #[serde(rename = "api_friend")]
    pub api_friend: i64,
    #[serde(rename = "api_ship")]
    pub api_ship: Vec<i64>,
    #[serde(rename = "api_slotitem")]
    pub api_slotitem: Vec<i64>,
    #[serde(rename = "api_furniture")]
    pub api_furniture: i64,
    #[serde(rename = "api_deckname")]
    pub api_deckname: String,
    #[serde(rename = "api_deckname_id")]
    pub api_deckname_id: String,
    #[serde(rename = "api_deck")]
    pub api_deck: ApiDeck,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDeck {
    #[serde(rename = "api_ships")]
    pub api_ships: Vec<ApiShip>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiShip {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: Option<i64>,
    #[serde(rename = "api_level")]
    pub api_level: Option<i64>,
    #[serde(rename = "api_star")]
    pub api_star: Option<i64>,
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

        let pattern_str = "S@api_req_member@get_practice_enemyinfo";
        let log_path = "./src/endpoints/api_req_member/get_practice_enemyinfo@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_member@get_practice_enemyinfo";
        let log_path = "./src/endpoints/api_req_member/get_practice_enemyinfo@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
