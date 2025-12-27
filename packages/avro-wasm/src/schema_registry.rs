use apache_avro::Schema;
use serde::Deserialize;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// Embed pre-generated schema JSON files at compile time
// These files are generated from kc-api-database models

#[cfg(feature = "schema_v1")]
static SCHEMA_V1_JSON: &str = include_str!("../../kc_api/generated-schemas/schema_v1.json");

#[cfg(feature = "schema_v2")]
static SCHEMA_V2_JSON: &str = include_str!("../../kc_api/generated-schemas/schema_v2.json");

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
            // Canonicalize the schema string for consistent comparison
            schema: match parse_schema_to_canonical(&e.schema) {
                Ok(c) => c,
                Err(err) => {
                    // In case of parse error (should not happen with valid generated files),
                    // fallback to original or panic. Panicking is safer for integrity.
                    panic!(
                        "Invalid schema in generated file for table {}: {}",
                        e.table_name, err
                    );
                }
            },
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
        #[cfg(feature = "schema_v1")]
        "v1" => Some(load_schema_set(SCHEMA_V1_JSON, "v1")),
        #[cfg(feature = "schema_v2")]
        "v2" => Some(load_schema_set(SCHEMA_V2_JSON, "v2")),
        _ => None,
    }
}

fn get_all_schema_sets_internal() -> Vec<SchemaSet> {
    let mut sets = Vec::new();
    #[cfg(feature = "schema_v1")]
    if let Some(s) = get_schema_set("v1") {
        sets.push(s);
    }
    #[cfg(feature = "schema_v2")]
    if let Some(s) = get_schema_set("v2") {
        sets.push(s);
    }
    sets
}

/// Schema matching result
#[wasm_bindgen]
pub struct SchemaMatchResult {
    matched: bool,
    version: Option<String>,
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
/// This function searches across ALL available schema versions (v1, v2, etc.)
/// to find a matching schema, enabling support for multiple API versions
/// in a single binary.
#[wasm_bindgen]
pub fn match_client_schema(schema_json: &str) -> SchemaMatchResult {
    // Normalize the schema for comparison (canonical form)
    let canonical_client = match parse_schema_to_canonical(schema_json) {
        Ok(c) => c,
        Err(e) => {
            return SchemaMatchResult {
                matched: false,
                version: None,
                table_name: None,
                error: Some(format!("Failed to parse client schema: {}", e)),
            };
        }
    };

    // Get all available schema sets (v1, v2, etc.)
    let all_schemas = get_all_schema_sets_internal();

    // Try to find a matching schema across all versions
    for schema_set in all_schemas {
        for table_schema in &schema_set.schemas {
            if table_schema.schema == canonical_client {
                return SchemaMatchResult {
                    matched: true,
                    version: Some(schema_set.version.clone()),
                    table_name: Some(table_schema.table_name.clone()),
                    error: None,
                };
            }
        }
    }

    SchemaMatchResult {
        matched: false,
        version: None,
        table_name: None,
        error: Some("Client schema does not match any known schema in any version".to_string()),
    }
}

/// Get schema for a given table from a specific version
#[wasm_bindgen]
pub fn get_schema_for_version(
    table_name: &str,
    version: &str, // "v1" or "v2"
) -> SchemaMatchResult {
    let schema_set = match get_schema_set(version) {
        Some(s) => s,
        None => {
            return SchemaMatchResult {
                matched: false,
                version: None,
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
            table_name: Some(table_name.to_string()),
            error: None,
        }
    } else {
        SchemaMatchResult {
            matched: false,
            version: None,
            table_name: None,
            error: Some(format!(
                "Table '{}' not found in version '{}'",
                table_name, version
            )),
        }
    }
}

/// Parse schema JSON and return its canonical form
/// This helps in schema comparison
pub fn parse_schema_to_canonical(schema_json: &str) -> Result<String, String> {
    let schema =
        Schema::parse_str(schema_json).map_err(|e| format!("Failed to parse schema: {}", e))?;
    Ok(schema.canonical_form())
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
    let mut versions = Vec::new();
    #[cfg(feature = "schema_v1")]
    versions.push("v1".to_string());
    #[cfg(feature = "schema_v2")]
    versions.push("v2".to_string());
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
        None => format!(
            r#"{{"error":"Unknown version '{}'. Available versions: v1, v2"}}"#,
            version
        ),
    }
}

// Internal helper to get schema set for validation
pub(crate) fn get_schema_set_for_validation(version: &str) -> Option<SchemaSet> {
    get_schema_set(version)
}

pub(crate) fn get_all_schema_sets_for_validation() -> Vec<SchemaSet> {
    get_all_schema_sets_internal()
}
