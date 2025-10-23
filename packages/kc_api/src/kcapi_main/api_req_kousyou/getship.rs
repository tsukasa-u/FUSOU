#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_kousyou@getship.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_kousyou/getship)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;

use register_trait::add_field;
use register_trait::register_struct;

use register_trait::FieldSizeChecker;
use register_trait::TraitForConvert;
use register_trait::TraitForRoot;
use register_trait::TraitForTest;

use crate::interface::interface::EmitData;

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
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
    #[serde(rename = "api_kdock_id")]
    pub api_kdock_id: String,
}

#[derive(FieldSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_kousyou/getship")]
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
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: i64,
    #[serde(rename = "api_kdock")]
    pub api_kdock: Vec<ApiKdock>,
    #[serde(rename = "api_ship")]
    pub api_ship: ApiShip,
    #[serde(rename = "api_slotitem")]
    pub api_slotitem: Vec<ApiSlotitem>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKdock {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_state")]
    pub api_state: i64,
    #[serde(rename = "api_created_ship_id")]
    pub api_created_ship_id: i64,
    #[serde(rename = "api_complete_time")]
    pub api_complete_time: i64,
    #[serde(rename = "api_complete_time_str")]
    pub api_complete_time_str: String,
    #[serde(rename = "api_item1")]
    pub api_item1: i64,
    #[serde(rename = "api_item2")]
    pub api_item2: i64,
    #[serde(rename = "api_item3")]
    pub api_item3: i64,
    #[serde(rename = "api_item4")]
    pub api_item4: i64,
    #[serde(rename = "api_item5")]
    pub api_item5: i64,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiShip {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_sortno")]
    pub api_sortno: i64,
    #[serde(rename = "api_ship_id")]
    pub api_ship_id: i64,
    #[serde(rename = "api_lv")]
    pub api_lv: i64,
    #[serde(rename = "api_exp")]
    pub api_exp: Vec<i64>,
    #[serde(rename = "api_nowhp")]
    pub api_nowhp: i64,
    #[serde(rename = "api_maxhp")]
    pub api_maxhp: i64,
    #[serde(rename = "api_soku")]
    pub api_soku: i64,
    #[serde(rename = "api_leng")]
    pub api_leng: i64,
    #[serde(rename = "api_slot")]
    pub api_slot: Vec<i64>,
    #[serde(rename = "api_onslot")]
    pub api_onslot: Vec<i64>,
    #[serde(rename = "api_slot_ex")]
    pub api_slot_ex: i64,
    #[serde(rename = "api_kyouka")]
    pub api_kyouka: Vec<i64>,
    #[serde(rename = "api_backs")]
    pub api_backs: i64,
    #[serde(rename = "api_fuel")]
    pub api_fuel: i64,
    #[serde(rename = "api_bull")]
    pub api_bull: i64,
    #[serde(rename = "api_slotnum")]
    pub api_slotnum: i64,
    #[serde(rename = "api_ndock_time")]
    pub api_ndock_time: i64,
    #[serde(rename = "api_ndock_item")]
    pub api_ndock_item: Vec<i64>,
    #[serde(rename = "api_srate")]
    pub api_srate: i64,
    #[serde(rename = "api_cond")]
    pub api_cond: i64,
    #[serde(rename = "api_karyoku")]
    pub api_karyoku: Vec<i64>,
    #[serde(rename = "api_raisou")]
    pub api_raisou: Vec<i64>,
    #[serde(rename = "api_taiku")]
    pub api_taiku: Vec<i64>,
    #[serde(rename = "api_soukou")]
    pub api_soukou: Vec<i64>,
    #[serde(rename = "api_kaihi")]
    pub api_kaihi: Vec<i64>,
    #[serde(rename = "api_taisen")]
    pub api_taisen: Vec<i64>,
    #[serde(rename = "api_sakuteki")]
    pub api_sakuteki: Vec<i64>,
    #[serde(rename = "api_lucky")]
    pub api_lucky: Vec<i64>,
    #[serde(rename = "api_locked")]
    pub api_locked: i64,
    #[serde(rename = "api_locked_equip")]
    pub api_locked_equip: i64,
    #[serde(rename = "api_sally_area")]
    pub api_sally_area: Option<i64>,
}

#[derive(FieldSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSlotitem {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_slotitem_id")]
    pub api_slotitem_id: i64,
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

        let pattern_str = "S@api_req_kousyou@getship";
        let log_path = "./src/kcapi_main/api_req_kousyou/getship@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_kousyou@getship";
        let log_path = "./src/kcapi_main/api_req_kousyou/getship@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
