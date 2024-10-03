use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use register_trait::{register_struct, add_field};

use register_trait:: {TraitForTest, Getter, TraitForRoot, TraitForConvert};

use crate::interface::interface::{EmitData, Add};
use crate::interface::ship::Ships;

#[derive(Getter, TraitForTest, TraitForRoot)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_sortie/battle")]
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
    #[serde(rename = "api_support_flag")]
    pub api_support_flag: i64,
    #[serde(rename = "api_support_info")]
    pub api_support_info: Value,
    #[serde(rename = "api_opening_taisen_flag")]
    pub api_opening_taisen_flag: i64,
    #[serde(rename = "api_opening_taisen")]
    pub api_opening_taisen: Option<ApiOpeningTaisen>,
    #[serde(rename = "api_opening_flag")]
    pub api_opening_flag: i64,
    #[serde(rename = "api_opening_atack")]
    pub api_opening_atack: Option<ApiOpeningAtack>,
    #[serde(rename = "api_hourai_flag")]
    pub api_hourai_flag: Vec<i64>,
    #[serde(rename = "api_hougeki1")]
    pub api_hougeki1: Option<ApiHougeki1>,
    #[serde(rename = "api_hougeki2")]
    pub api_hougeki2: Option<ApiHougeki2>,
    #[serde(rename = "api_hougeki3")]
    pub api_hougeki3: Value,
    #[serde(rename = "api_raigeki")]
    pub api_raigeki: Option<ApiRaigeki>,
    #[serde(rename = "api_flavor_info")]
    pub api_flavor_info: Option<Vec<ApiFlavoInfo>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiHougeki1 {
    #[serde(rename = "api_at_eflag")]
    pub api_at_eflag: Vec<i64>,
    #[serde(rename = "api_at_list")]
    pub api_at_list: Vec<i64>,
    #[serde(rename = "api_at_type")]
    pub api_at_type: Vec<i64>,
    #[serde(rename = "api_df_list")]
    pub api_df_list: Vec<Vec<i64>>,
    #[serde(rename = "api_si_list")]
    pub api_si_list: Vec<Vec<Value>>, 
    #[serde(rename = "api_cl_list")]
    pub api_cl_list: Vec<Vec<i64>>,
    #[serde(rename = "api_damage")]
    pub api_damage: Vec<Vec<f32>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiHougeki2 {
    #[serde(rename = "api_at_eflag")]
    pub api_at_eflag: Vec<i64>,
    #[serde(rename = "api_at_list")]
    pub api_at_list: Vec<i64>,
    #[serde(rename = "api_at_type")]
    pub api_at_type: Vec<i64>,
    #[serde(rename = "api_df_list")]
    pub api_df_list: Vec<Vec<i64>>,
    #[serde(rename = "api_si_list")]
    pub api_si_list: Vec<Vec<Value>>,
    #[serde(rename = "api_cl_list")]
    pub api_cl_list: Vec<Vec<i64>>,
    #[serde(rename = "api_damage")]
    pub api_damage: Vec<Vec<f32>>
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiOpeningTaisen {
    #[serde(rename = "api_at_eflag")]
    pub api_at_eflag: Vec<i64>,
    #[serde(rename = "api_at_list")]
    pub api_at_list: Vec<i64>,
    #[serde(rename = "api_at_type")]
    pub api_at_type: Vec<i64>,
    #[serde(rename = "api_df_list")]
    pub api_df_list: Vec<Vec<i64>>,
    #[serde(rename = "api_si_list")]
    pub api_si_list: Vec<Vec<Value>>,
    #[serde(rename = "api_cl_list")]
    pub api_cl_list: Vec<Vec<i64>>,
    #[serde(rename = "api_damage")]
    pub api_damage: Vec<Vec<f64>>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRaigeki {
    #[serde(rename = "api_frai")]
    pub api_frai: Vec<i64>,
    #[serde(rename = "api_fcl")]
    pub api_fcl: Vec<i64>,
    #[serde(rename = "api_fdam")]
    pub api_fdam: Vec<f32>,
    #[serde(rename = "api_fydam")]
    pub api_fydam: Vec<i64>,
    #[serde(rename = "api_erai")]
    pub api_erai: Vec<i64>,
    #[serde(rename = "api_ecl")]
    pub api_ecl: Vec<i64>,
    #[serde(rename = "api_edam")]
    pub api_edam: Vec<f32>,
    #[serde(rename = "api_eydam")]
    pub api_eydam: Vec<i64>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFlavoInfo {
    #[serde(rename = "api_boss_ship_id")]
    pub api_boss_ship_id: String,
    #[serde(rename = "api_type")]
    pub api_type: String,
    #[serde(rename = "api_voice_id")]
    pub api_voice_id: String,
    #[serde(rename = "api_class_name")]
    pub api_class_name: String,
    #[serde(rename = "api_ship_name")]
    pub api_ship_name: String,
    #[serde(rename = "api_message")]
    pub api_message: String,
    #[serde(rename = "api_pos_x")]
    pub api_pos_x: String,
    #[serde(rename = "api_pos_y")]
    pub api_pos_y: String,
    #[serde(rename = "api_data")]
    pub api_data: String
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
    pub api_stage2: Option<ApiStage2>,
    #[serde(rename = "api_stage3")]
    pub api_stage3: Option<ApiStage3>,
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
pub struct ApiAirFire {
    #[serde(rename = "api_idx")]
    pub api_idx: i64,
    #[serde(rename = "api_kind")]
    pub api_kind: i64,
    #[serde(rename = "api_use_items")]
    pub api_use_items: Vec<i64>,
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
    pub api_fdam: Vec<f32>,
    #[serde(rename = "api_edam")]
    pub api_edam: Vec<f32>,
    #[serde(rename = "api_f_sp_list")]
    pub api_f_sp_list: Vec<Value>,
    #[serde(rename = "api_e_sp_list")]
    pub api_e_sp_list: Vec<Value>,
}

#[derive(Getter, TraitForTest)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiOpeningAtack {
    #[serde(rename = "api_frai_list_items")]
    pub api_frai_list_items: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_fcl_list_items")]
    pub api_fcl_list_items: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_fdam")]
    pub api_fdam: Vec<f32>,
    #[serde(rename = "api_fydam_list_items")]
    pub api_fydam_list_items: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_erai_list_items")]
    pub api_erai_list_items: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_ecl_list_items")]
    pub api_ecl_list_items: Vec<Option<Vec<i64>>>,
    #[serde(rename = "api_edam")]
    pub api_edam: Vec<f32>,
    #[serde(rename = "api_eydam_list_items")]
    pub api_eydam_list_items: Vec<Option<Vec<i64>>>,
}

impl TraitForConvert for Root {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let ships: Ships = self.api_data.clone().into();
        Some(vec![EmitData::Add(Add::Ships(ships))])
    }
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;

    #[test]
    fn test_deserialize() {
        let target_path = "./../../test_data";
        let pattern_str = "S@api_req_sortie@battle.json";
        let log_path = "./src/kc2api/api_req_sortie/battle.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}