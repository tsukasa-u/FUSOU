mod utils;
mod validator;
mod schema_registry;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

// Re-export main validation functions
pub use validator::{
    validate_avro_ocf,
    validate_avro_ocf_smart,
    validate_avro_ocf_by_table,
};
pub use schema_registry::{
    match_client_schema,
    get_available_schemas,
    get_available_versions,
    get_all_available_schemas,
    get_schema_json,
    get_schema_for_version,
};
