use std::collections::HashMap;
use serde::{Deserialize, Serialize};
// use serde_json::Value;

use register_macro_derive_and_attr::register_struct;
use register_macro_derive_and_attr::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_macro_derive_and_attr::TraitForRoot;

#[derive(Getter, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_get_member/require_info")]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    #[serde(rename = "api_result")]
    pub api_result: i64,
    #[serde(rename = "api_result_msg")]
    pub api_result_msg: String,
    #[serde(rename = "api_data")]
    pub api_data: ApiData,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiData {
    #[serde(rename = "api_basic")]
    pub api_basic: ApiBasic,
    #[serde(rename = "api_slot_item")]
    pub api_slot_item: Vec<ApiSlotItem>,
    #[serde(rename = "api_unsetslot")]
    pub api_unsetslot: HashMap<String, Vec<i64>>,
    #[serde(rename = "api_kdock")]
    pub api_kdock: Vec<ApiKdock>,
    #[serde(rename = "api_useitem")]
    pub api_useitem: Vec<ApiUseitem>,
    #[serde(rename = "api_furniture")]
    pub api_furniture: Vec<ApiFurniture>,
    #[serde(rename = "api_extra_supply")]
    pub api_extra_supply: Vec<i64>,
    #[serde(rename = "api_oss_setting")]
    pub api_oss_setting: ApiOssSetting,
    #[serde(rename = "api_skin_id")]
    pub api_skin_id: i64,
    #[serde(rename = "api_position_id")]
    pub api_position_id: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiBasic {
    #[serde(rename = "api_member_id")]
    pub api_member_id: i64,
    #[serde(rename = "api_firstflag")]
    pub api_firstflag: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSlotItem {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_slotitem_id")]
    pub api_slotitem_id: i64,
    #[serde(rename = "api_locked")]
    pub api_locked: i64,
    #[serde(rename = "api_level")]
    pub api_level: i64,
    #[serde(rename = "api_alv")]
    pub api_alv: Option<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiUnsetslot {
    #[serde(rename = "api_slottype23")]
    pub api_slottype23: Vec<i64>,
    #[serde(rename = "api_slottype7")]
    pub api_slottype7: Vec<i64>,
    #[serde(rename = "api_slottype6")]
    pub api_slottype6: Vec<i64>,
    #[serde(rename = "api_slottype8")]
    pub api_slottype8: Vec<i64>,
    #[serde(rename = "api_slottype3")]
    pub api_slottype3: Vec<i64>,
    #[serde(rename = "api_slottype4")]
    pub api_slottype4: Vec<i64>,
    #[serde(rename = "api_slottype2")]
    pub api_slottype2: Vec<i64>,
    #[serde(rename = "api_slottype13")]
    pub api_slottype13: Vec<i64>,
    #[serde(rename = "api_slottype11")]
    pub api_slottype11: Vec<i64>,
    #[serde(rename = "api_slottype21")]
    pub api_slottype21: Vec<i64>,
    #[serde(rename = "api_slottype28")]
    pub api_slottype28: Vec<i64>,
    #[serde(rename = "api_slottype15")]
    pub api_slottype15: Vec<i64>,
    #[serde(rename = "api_slottype22")]
    pub api_slottype22: Vec<i64>,
    #[serde(rename = "api_slottype17")]
    pub api_slottype17: Vec<i64>,
    #[serde(rename = "api_slottype27")]
    pub api_slottype27: Vec<i64>,
    #[serde(rename = "api_slottype1")]
    pub api_slottype1: Vec<i64>,
    #[serde(rename = "api_slottype43")]
    pub api_slottype43: Vec<i64>,
    #[serde(rename = "api_slottype48")]
    pub api_slottype48: Vec<i64>,
    #[serde(rename = "api_slottype44")]
    pub api_slottype44: Vec<i64>,
    #[serde(rename = "api_slottype29")]
    pub api_slottype29: Vec<i64>,
    #[serde(rename = "api_slottype5")]
    pub api_slottype5: Vec<i64>,
    #[serde(rename = "api_slottype25")]
    pub api_slottype25: Vec<i64>,
    #[serde(rename = "api_slottype10")]
    pub api_slottype10: Vec<i64>,
    #[serde(rename = "api_slottype41")]
    pub api_slottype41: Vec<i64>,
    #[serde(rename = "api_slottype12")]
    pub api_slottype12: Vec<i64>,
    #[serde(rename = "api_slottype26")]
    pub api_slottype26: Vec<i64>,
    #[serde(rename = "api_slottype9")]
    pub api_slottype9: Vec<i64>,
    #[serde(rename = "api_slottype36")]
    pub api_slottype36: Vec<i64>,
    #[serde(rename = "api_slottype24")]
    pub api_slottype24: Vec<i64>,
    #[serde(rename = "api_slottype37")]
    pub api_slottype37: Vec<i64>,
    #[serde(rename = "api_slottype47")]
    pub api_slottype47: Vec<i64>,
    #[serde(rename = "api_slottype14")]
    pub api_slottype14: Vec<i64>,
    #[serde(rename = "api_slottype32")]
    pub api_slottype32: Vec<i64>,
    #[serde(rename = "api_slottype54")]
    pub api_slottype54: Vec<i64>,
    #[serde(rename = "api_slottype34")]
    pub api_slottype34: Vec<i64>,
    #[serde(rename = "api_slottype30")]
    pub api_slottype30: Vec<i64>,
    #[serde(rename = "api_slottype42")]
    pub api_slottype42: Vec<i64>,
    #[serde(rename = "api_slottype35")]
    pub api_slottype35: Vec<i64>,
    #[serde(rename = "api_slottype51")]
    pub api_slottype51: Vec<i64>,
    #[serde(rename = "api_slottype18")]
    pub api_slottype18: Vec<i64>,
    #[serde(rename = "api_slottype19")]
    pub api_slottype19: Vec<i64>,
    #[serde(rename = "api_slottype46")]
    pub api_slottype46: Vec<i64>,
    #[serde(rename = "api_slottype94")]
    pub api_slottype94: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
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

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiUseitem {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_count")]
    pub api_count: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFurniture {
    #[serde(rename = "api_id")]
    pub api_id: i64,
    #[serde(rename = "api_furniture_type")]
    pub api_furniture_type: i64,
    #[serde(rename = "api_furniture_no")]
    pub api_furniture_no: i64,
    #[serde(rename = "api_furniture_id")]
    pub api_furniture_id: i64,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiOssSetting {
    #[serde(rename = "api_language_type")]
    pub api_language_type: i64,
    #[serde(rename = "api_oss_items")]
    pub api_oss_items: Vec<i64>,
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;

    #[test]
    fn test_deserialize() {
        let target_path = "./src/kc2api/test_data";
        let pattern_str = "S@api_get_member@require_info.json";
        let log_path = "./src/kc2api/api_get_member/require_info.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}