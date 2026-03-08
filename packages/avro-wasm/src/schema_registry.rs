use apache_avro::Schema;
use serde::Deserialize;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// Embed pre-generated schema JSON files at compile time
// These files are generated from kc-api-database models

#[cfg(feature = "schema_v0_4")]
static SCHEMA_V0_4_JSON: &str = include_str!("../../kc_api/generated-schemas/schema_v0_4.json");

#[cfg(feature = "schema_v0_5")]
static SCHEMA_V0_5_JSON: &str = include_str!("../../kc_api/generated-schemas/schema_v0_5.json");

// #[cfg(feature = "schema_v0_6")]
// static SCHEMA_V0_6_JSON: &str = include_str!("../../kc_api/generated-schemas/schema_v0_6.json");

#[derive(Debug, Deserialize)]
struct SchemaEntry {
    schema: String,
    table_name: String,
}

#[derive(Debug, Deserialize)]
struct SchemaSetJson {
    schemas: Vec<SchemaEntry>,
    table_version: String,
}

#[derive(Debug, Clone)]
pub struct TableSchema {
    pub table_name: String,
    pub schema: String,
}

#[derive(Debug, Clone)]
pub struct SchemaSet {
    pub version: String,
    pub table_version: String,
    pub schemas: Vec<TableSchema>,
    pub schemas_map: HashMap<String, String>,
}

fn load_schema_set(json_str: &str, version: &str) -> SchemaSet {
    let parsed: SchemaSetJson =
        serde_json::from_str(json_str).expect("Failed to parse embedded schema JSON");

    let schemas: Vec<TableSchema> = parsed
        .schemas
        .iter()
        .map(|e| TableSchema {
            table_name: e.table_name.clone(),
            // Store the raw schema JSON as-is (includes logicalType)
            // Both client and server schemas should be canonicalized during comparison
            schema: e.schema.clone(),
        })
        .collect();

    let schemas_map: HashMap<String, String> = schemas
        .iter()
        .map(|s| (s.table_name.clone(), s.schema.clone()))
        .collect();

    SchemaSet {
        version: version.to_string(),
        table_version: parsed.table_version,
        schemas,
        schemas_map,
    }
}

fn get_schema_set(version: &str) -> Option<SchemaSet> {
    match version {
        #[cfg(feature = "schema_v0_4")]
        "v0_4" => Some(load_schema_set(SCHEMA_V0_4_JSON, "v0_4")),
        #[cfg(feature = "schema_v0_5")]
        "v0_5" => Some(load_schema_set(SCHEMA_V0_5_JSON, "v0_5")),
        // #[cfg(feature = "schema_v0_6")]
        // "v0_6" => Some(load_schema_set(SCHEMA_V0_6_JSON, "v0_6")),
        _ => None,
    }
}

fn get_all_schema_sets_internal() -> Vec<SchemaSet> {
    let mut sets = Vec::new();
    #[cfg(feature = "schema_v0_4")]
    if let Some(s) = get_schema_set("v0_4") {
        sets.push(s);
    }
    #[cfg(feature = "schema_v0_5")]
    if let Some(s) = get_schema_set("v0_5") {
        sets.push(s);
    }
    // #[cfg(feature = "schema_v0_6")]
    // if let Some(s) = get_schema_set("v0_6") {
    //     sets.push(s);
    // }
    sets
}

/// Schema matching result
#[wasm_bindgen]
pub struct SchemaMatchResult {
    matched: bool,
    version: Option<String>,
    table_version: Option<String>,
    table_name: Option<String>,
    error: Option<String>,
}

#[wasm_bindgen]
impl SchemaMatchResult {
    #[wasm_bindgen(getter)]
    pub fn matched(&self) -> bool {
        self.matched
    }

    #[wasm_bindgen(getter)]
    pub fn version(&self) -> Option<String> {
        self.version.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn table_version(&self) -> Option<String> {
        self.table_version.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn table_name(&self) -> Option<String> {
        self.table_name.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn error(&self) -> Option<String> {
        self.error.clone()
    }
}

/// Match client-provided OCF header schema against known schemas
/// Returns the matched version and table name if found
///
/// This function searches across ALL available schema versions
/// to find a matching schema, enabling support for multiple API versions
/// in a single binary.
///
/// `hint_table_version`: optional hint from the client's declared table_version.
/// When multiple schema versions share the same canonical form (identical schemas),
/// the hint is used to disambiguate and return the correct version.
/// Pass an empty string to skip hint-based matching (backward compatible).
#[wasm_bindgen]
pub fn match_client_schema(schema_json: &str, hint_table_version: &str) -> SchemaMatchResult {
    // Parse the client schema
    let client_schema = match Schema::parse_str(schema_json) {
        Ok(s) => s,
        Err(e) => {
            return SchemaMatchResult {
                matched: false,
                version: None,
                table_version: None,
                table_name: None,
                error: Some(format!("Failed to parse client schema: {}", e)),
            };
        }
    };
    let canonical_client = client_schema.canonical_form();

    // Get all available schema sets (v0_4, v0_5, v0_6, etc.)
    let all_schemas = get_all_schema_sets_internal();
    let mut available_versions: Vec<String> = Vec::new();
    let mut first_match: Option<SchemaMatchResult> = None;

    // Try to find a matching schema across all versions
    for schema_set in &all_schemas {
        available_versions.push(format!("{}(table:{})", schema_set.version, schema_set.table_version));
        for table_schema in &schema_set.schemas {
            // Parse the server schema and get its canonical form
            if let Ok(server_schema) = Schema::parse_str(&table_schema.schema) {
                let canonical_server = server_schema.canonical_form();
                if canonical_server == canonical_client {
                    let result = SchemaMatchResult {
                        matched: true,
                        version: Some(schema_set.version.clone()),
                        table_version: Some(schema_set.table_version.clone()),
                        table_name: Some(table_schema.table_name.clone()),
                        error: None,
                    };

                    // If client provided a hint and this version matches, return immediately
                    if !hint_table_version.is_empty()
                        && schema_set.table_version == hint_table_version
                    {
                        return result;
                    }

                    // Store the first canonical match as fallback
                    if first_match.is_none() {
                        first_match = Some(result);
                    }
                    // Once we find ONE match per version, no need to check other tables
                    // in the same version (they share the same table_version)
                    break;
                }
            }
        }
    }

    // If hint didn't match any version but canonical form matched, return first match
    if let Some(m) = first_match {
        return m;
    }

    SchemaMatchResult {
        matched: false,
        version: None,
        table_version: None,
        table_name: None,
        error: Some(format!(
            "Client schema does not match any known schema. Available versions: {}",
            available_versions.join(", ")
        )),
    }
}

/// Get schema for a given table from a specific version
#[wasm_bindgen]
pub fn get_schema_for_version(
    table_name: &str,
    version: &str, // "v0_4", "v0_5", "v0_6", etc.
) -> SchemaMatchResult {
    let schema_set = match get_schema_set(version) {
        Some(s) => s,
        None => {
            return SchemaMatchResult {
                matched: false,
                version: None,
                table_version: None,
                table_name: None,
                error: Some(format!("Unknown schema version: '{}'", version)),
            };
        }
    };

    // Try to find the table schema
    if schema_set.schemas_map.contains_key(table_name) {
        SchemaMatchResult {
            matched: true,
            version: Some(version.to_string()),
            table_version: Some(schema_set.table_version.clone()),
            table_name: Some(table_name.to_string()),
            error: None,
        }
    } else {
        SchemaMatchResult {
            matched: false,
            version: None,
            table_version: None,
            table_name: None,
            error: Some(format!(
                "Table '{}' not found in version '{}'",
                table_name, version
            )),
        }
    }
}

/// Get all available table schemas across all versions
#[wasm_bindgen]
pub fn get_all_available_schemas() -> Vec<String> {
    let mut all_tables = Vec::new();
    for schema_set in get_all_schema_sets_internal() {
        for schema in &schema_set.schemas {
            all_tables.push(format!("{}@{}", schema.table_name, schema_set.version));
        }
    }
    all_tables
}

/// Get available table schemas for a specific version
#[wasm_bindgen]
pub fn get_available_schemas(version: &str) -> Vec<String> {
    match get_schema_set(version) {
        Some(schema_set) => schema_set
            .schemas
            .iter()
            .map(|s| s.table_name.clone())
            .collect(),
        None => vec![],
    }
}

/// Get all available schema versions
#[wasm_bindgen]
pub fn get_available_versions() -> Vec<String> {
    #[allow(unused_mut)]
    let mut versions = Vec::new();
    #[cfg(feature = "schema_v0_4")]
    versions.push("v0_4".to_string());
    #[cfg(feature = "schema_v0_5")]
    versions.push("v0_5".to_string());
    #[cfg(feature = "schema_v0_6")]
    versions.push("v0_6".to_string());
    versions
}

/// Get schema by table name and version (returns JSON string or error)
#[wasm_bindgen]
pub fn get_schema_json(table_name: &str, version: &str) -> String {
    match get_schema_set(version) {
        Some(schema_set) => match schema_set.schemas_map.get(table_name) {
            Some(schema) => schema.clone(),
            None => format!(
                r#"{{"error":"Table '{}' not found in version '{}'"}}"#,
                table_name, version
            ),
        },
        None => {
            let available = get_available_versions();
            let available_str = if available.is_empty() {
                "none".to_string()
            } else {
                available.join(", ")
            };
            format!(
                r#"{{"error":"Unknown version '{}'. Available versions: {}"}}"#,
                version, available_str
            )
        }
    }
}

// Internal helper to get schema set for validation
pub(crate) fn get_schema_set_for_validation(version: &str) -> Option<SchemaSet> {
    get_schema_set(version)
}


