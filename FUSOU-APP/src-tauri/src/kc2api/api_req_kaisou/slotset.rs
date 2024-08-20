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
#[register_struct(name = "api_req_kaisou/slotset", path = "./tests/struct_names")]
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
        let target_path = "./src/kc2api/test_data";
        let pattern_str = "S@api_req_kaisou@slotset.json";
        let log_path = "./src/kc2api/api_req_kaisou/slotset.log";
        simple_root_test::<Root>(target_path.to_string(), pattern_str.to_string(), log_path.to_string());
    }
}