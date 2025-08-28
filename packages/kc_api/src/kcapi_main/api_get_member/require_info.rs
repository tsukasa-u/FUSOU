#![doc = "# kanColle API"]
#![doc = "KC APIs are also dependent on kcapi::kcapi_common."]
#![doc = "The dependency graph of the APIs is shown below."]
#![doc = register_trait::insert_svg!(path="./tests/struct_dependency_svg/api_get_member@require_info.svg", id="kc-dependency-svg-embed", style="border: 1px solid black; height:80vh; width:100%", role="img", aria_label="KC_API_dependency(api_get_member/require_info)")]
#![doc = include_str!("../../js/svg_pan_zoom.html")]

use serde::Deserialize;
use std::collections::HashMap;

use register_trait::{add_field, register_struct};

use register_trait::{Getter, TraitForConvert, TraitForRoot, TraitForTest};

use crate::interface::interface::{EmitData, Identifier, Set};
use crate::interface::slot_item::SlotItems;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
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
}

#[derive(Getter, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_get_member/require_info")]
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

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
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
#[derive(Debug, Clone, Deserialize)]
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
#[derive(Debug, Clone, Deserialize)]
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

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Debug, Clone, Deserialize)]
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
#[derive(Debug, Clone, Deserialize)]
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
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiOssSetting {
    #[serde(rename = "api_language_type")]
    pub api_language_type: i64,
    #[serde(rename = "api_oss_items")]
    pub api_oss_items: Vec<i64>,
}

impl TraitForConvert for Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let slot_item: SlotItems = self.api_data.api_slot_item.clone().into();

        Some(vec![
            EmitData::Set(Set::SlotItems(slot_item)),
            EmitData::Identifier(Identifier::RequireInfo(())),
        ])
    }
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

        let pattern_str = "S@api_get_member@require_info";
        let log_path = "./src/kcapi_main/api_get_member/require_info@S.log";
        simple_root_test::<Res>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );

        let pattern_str = "Q@api_get_member@require_info";
        let log_path = "./src/kcapi_main/api_get_member/require_info@Q.log";
        simple_root_test::<Req>(
            target_path.clone(),
            pattern_str.to_string(),
            log_path.to_string(),
        );
    }
}
