use std::collections::HashMap;
use serde::{Deserialize, Serialize};
// use serde_json::Value;

use register_trait::register_struct;
use register_trait::add_field;

use register_trait::TraitForTest;
use register_trait::Getter;
use register_trait::TraitForRoot;
use register_trait::TraitForConvert;

#[derive(Getter, TraitForTest, TraitForRoot, TraitForConvert)]
#[struct_test_case(field_extra, type_value, integration)]
#[add_field(extra)]
#[register_struct(name = "api_req_quest/stop")]
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    #[serde(rename = "api_result")]
    pub api_result: i64,
    #[serde(rename = "api_result_msg")]
    pub api_result_msg: String,
}

#[cfg(test)]
mod tests {
    use register_trait::simple_root_test;

    use super::*;

    #[test]
    fn test_deserialize() {
        let target_path = "./../../test_data";
        let pattern_str = "S@api_req_quest@stop.json";
        let log_path = "./src/kc2api/api_req_quest/stop.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}