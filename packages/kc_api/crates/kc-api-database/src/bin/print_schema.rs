use kc_api_database::{DATABASE_TABLE_VERSION, PortTableEnum};
use serde_json::json;

fn main() {
    let output = json!({
        "table_version": DATABASE_TABLE_VERSION,
        "schemas": PortTableEnum::all_schemas_json(),
    });

    println!("{}", serde_json::to_string_pretty(&output).unwrap());
}
