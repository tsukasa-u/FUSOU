use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

use crate::interface::interface::EmitData;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[convert_output(output = EmitData)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_sortie/ld_airbattle")]
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
    #[serde(rename = "api_deck_id")]
    pub api_deck_id: i64,
    #[serde(rename = "api_formation")]
    pub api_formation: Vec<i64>,
    #[serde(rename = "api_f_nowhps")]
    pub api_f_nowhps: Vec<i64>,
    #[serde(rename = "api_f_maxhps")]
    pub api_f_maxhps: Vec<i64>,
    #[serde(rename = "api_fParam")]
    pub api_f_param: Vec<Vec<i64>>,
    #[serde(rename = "api_ship_ke")]
    pub api_ship_ke: Vec<i64>,
    #[serde(rename = "api_ship_lv")]
    pub api_ship_lv: Vec<i64>,
    #[serde(rename = "api_e_nowhps")]
    pub api_e_nowhps: Vec<i64>,
    #[serde(rename = "api_e_maxhps")]
    pub api_e_maxhps: Vec<i64>,
    #[serde(rename = "api_eSlot")]
    pub api_e_slot: Vec<Vec<i64>>,
    #[serde(rename = "api_eParam")]
    pub api_e_param: Vec<Vec<i64>>,
    #[serde(rename = "api_smoke_type")]
    pub api_smoke_type: i64,
    #[serde(rename = "api_balloon_cell")]
    pub api_balloon_cell: i64,
    #[serde(rename = "api_atoll_cell")]
    pub api_atoll_cell: i64,
    #[serde(rename = "api_midnight_flag")]
    pub api_midnight_flag: i64,
    #[serde(rename = "api_search")]
    pub api_search: Vec<i64>,
    #[serde(rename = "api_stage_flag")]
    pub api_stage_flag: Vec<i64>,
    #[serde(rename = "api_kouku")]
    pub api_kouku: ApiKouku,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKouku {
    #[serde(rename = "api_plane_from")]
    pub api_plane_from: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_stage1")]
    pub api_stage1: ApiStage1,
    #[serde(rename = "api_stage2")]
    pub api_stage2: ApiStage2,
    #[serde(rename = "api_stage3")]
    pub api_stage3: ApiStage3,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAirFire {
    #[serde(rename = "api_idx")]
    api_idx: i64,
    #[serde(rename = "api_kind")]
    api_kind: i64,
    #[serde(rename = "api_use_items")]
    api_use_items: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStage1 {
    #[serde(rename = "api_f_count")]
    pub api_f_count: i64,
    #[serde(rename = "api_f_lostcount")]
    pub api_f_lostcount: i64,
    #[serde(rename = "api_e_count")]
    pub api_e_count: i64,
    #[serde(rename = "api_e_lostcount")]
    pub api_e_lostcount: i64,
    #[serde(rename = "api_disp_seiku")]
    pub api_disp_seiku: i64,
    #[serde(rename = "api_touch_plane")]
    pub api_touch_plane: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStage2 {
    #[serde(rename = "api_f_count")]
    pub api_f_count: i64,
    #[serde(rename = "api_f_lostcount")]
    pub api_f_lostcount: i64,
    #[serde(rename = "api_e_count")]
    pub api_e_count: i64,
    #[serde(rename = "api_e_lostcount")]
    pub api_e_lostcount: i64,
    #[serde(rename = "api_air_fire")]
    pub api_air_fire: Option<ApiAirFire>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStage3 {
    #[serde(rename = "api_frai_flag")]
    pub api_frai_flag: Vec<i64>,
    #[serde(rename = "api_erai_flag")]
    pub api_erai_flag: Vec<i64>,
    #[serde(rename = "api_fbak_flag")]
    pub api_fbak_flag: Vec<i64>,
    #[serde(rename = "api_ebak_flag")]
    pub api_ebak_flag: Vec<i64>,
    #[serde(rename = "api_fcl_flag")]
    pub api_fcl_flag: Vec<i64>,
    #[serde(rename = "api_ecl_flag")]
    pub api_ecl_flag: Vec<i64>,
    #[serde(rename = "api_fdam")]
    pub api_fdam: Vec<f64>,
    #[serde(rename = "api_edam")]
    pub api_edam: Vec<i64>,
    #[serde(rename = "api_f_sp_list")]
    pub api_f_sp_list: Vec<Value>,
    #[serde(rename = "api_e_sp_list")]
    pub api_e_sp_list: Vec<Value>,
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;

    #[test]
    fn test_deserialize() {
        let target_path = "./../../test_data";
        let pattern_str = "S@api_req_sortie@ld_airbattle.json";
        let log_path = "./src/kc2api/api_req_sortie/ld_airbattle.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}