#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_kousyou@getship.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_kousyou/getship)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

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
    pub api_kdock_id: String,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_kousyou/getship")]
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
    pub api_id: i64,
    pub api_ship_id: i64,
    pub api_kdock: Vec<ApiKdock>,
    pub api_ship: ApiShip,
    pub api_slotitem: Vec<ApiSlotitem>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiKdock {
    pub api_id: i64,
    pub api_state: i64,
    pub api_created_ship_id: i64,
    pub api_complete_time: i64,
    pub api_complete_time_str: String,
    pub api_item1: i64,
    pub api_item2: i64,
    pub api_item3: i64,
    pub api_item4: i64,
    pub api_item5: i64,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiShip {
    pub api_id: i64,
    pub api_sortno: i64,
    pub api_ship_id: i64,
    pub api_lv: i64,
    pub api_exp: Vec<i64>,
    pub api_nowhp: i64,
    pub api_maxhp: i64,
    pub api_soku: i64,
    pub api_leng: i64,
    pub api_slot: Vec<i64>,
    pub api_onslot: Vec<i64>,
    pub api_slot_ex: i64,
    pub api_kyouka: Vec<i64>,
    pub api_backs: i64,
    pub api_fuel: i64,
    pub api_bull: i64,
    pub api_slotnum: i64,
    pub api_ndock_time: i64,
    pub api_ndock_item: Vec<i64>,
    pub api_srate: i64,
    pub api_cond: i64,
    pub api_karyoku: Vec<i64>,
    pub api_raisou: Vec<i64>,
    pub api_taiku: Vec<i64>,
    pub api_soukou: Vec<i64>,
    pub api_kaihi: Vec<i64>,
    pub api_taisen: Vec<i64>,
    pub api_sakuteki: Vec<i64>,
    pub api_lucky: Vec<i64>,
    pub api_locked: i64,
    pub api_locked_equip: i64,
    pub api_sally_area: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSlotitem {
    pub api_id: i64,
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
