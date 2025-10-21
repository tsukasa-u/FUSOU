#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_req_kaisou@slot_deprive.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_req_kaisou/slot_deprive)")]
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
    pub api_set_slot_kind: String,
    pub api_set_idx: String,
    pub api_set_ship: String,
    pub api_unset_idx: String,
    pub api_unset_slot_kind: String,
    pub api_unset_ship: String,
}

#[derive(NumberSizeChecker, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_kaisou/slot_deprive")]
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
    pub api_ship_data: ApiShipData,
    pub api_unset_list: Option<ApiUnsetList>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiShipData {
    pub api_unset_ship: ApiUnsetShip,
    pub api_set_ship: ApiSetShip,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiUnsetShip {
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
    pub api_sp_effect_items: Option<Vec<ApiSpEffectItems>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSetShip {
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
    pub api_sp_effect_items: Option<Vec<ApiSpEffectItems>>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiSpEffectItems {
    pub api_kind: i64,
    pub api_raig: Option<i64>,
    pub api_souk: Option<i64>,
    pub api_houg: Option<i64>,
    pub api_kaih: Option<i64>,
}

#[derive(NumberSizeChecker, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
pub struct ApiUnsetList {
    #[serde(rename = "api_type3No")]
    pub api_type3_no: i64,
    pub api_slot_list: Vec<i64>,
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

        let pattern_str = "S@api_req_kaisou@slot_deprive";
        let log_path = "./src/kcapi_main/api_req_kaisou/slot_deprive@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_req_kaisou@slot_deprive";
        let log_path = "./src/kcapi_main/api_req_kaisou/slot_deprive@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
