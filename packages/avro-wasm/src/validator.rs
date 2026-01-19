use apache_avro::{Reader, Schema};
use wasm_bindgen::prelude::*;
use crate::schema_registry;
use crate::utils;

#[wasm_bindgen]
pub struct ValidationResult {
    valid: bool,
    record_count: Option<u32>,
    error_message: Option<String>,
    schema_version: Option<String>,
    table_name: Option<String>,
}

#[wasm_bindgen]
impl ValidationResult {
    #[wasm_bindgen(getter)]
    pub fn valid(&self) -> bool {
        self.valid
    }
    
    #[wasm_bindgen(getter)]
    pub fn record_count(&self) -> Option<u32> {
        self.record_count
    }
    
    #[wasm_bindgen(getter)]
    pub fn error_message(&self) -> Option<String> {
        self.error_message.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn schema_version(&self) -> Option<String> {
        self.schema_version.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn table_name(&self) -> Option<String> {
        self.table_name.clone()
    }
}

/// Validate Avro OCF data with automatic schema detection and matching
/// 
/// This function:
/// 1. Extracts schema from OCF header
/// 2. Matches it against known schemas from kc-api-database
/// 3. Validates the data conforms to that schema
/// 4. Returns version and table information
#[wasm_bindgen]
pub fn validate_avro_ocf_smart(avro_data: &[u8]) -> ValidationResult {
    utils::set_panic_hook();
    
    // Step 1: Check basic OCF structure
    if avro_data.len() < 4 {
        return ValidationResult {
            valid: false,
            record_count: None,
            error_message: Some("Avro file too small".to_string()),
            schema_version: None,
            table_name: None,
        };
    }
    
    // Check magic bytes "Obj\x01"
    if avro_data[0] != 0x4F || avro_data[1] != 0x62 
        || avro_data[2] != 0x6A || avro_data[3] != 0x01 {
        return ValidationResult {
            valid: false,
            record_count: None,
            error_message: Some("Invalid Avro magic bytes".to_string()),
            schema_version: None,
            table_name: None,
        };
    }
    
    // Step 2: Extract schema from OCF header
    let client_schema_json = match extract_schema_from_ocf_header(avro_data) {
        Some(s) => s,
        None => {
            return ValidationResult {
                valid: false,
                record_count: None,
                error_message: Some("Could not extract schema from OCF header".to_string()),
                schema_version: None,
                table_name: None,
            };
        }
    };
    
    // Step 3: Match client schema against known schemas
    let match_result = schema_registry::match_client_schema(&client_schema_json);
    
    if !match_result.matched() {
        return ValidationResult {
            valid: false,
            record_count: None,
            error_message: match_result.error(),
            schema_version: None,
            table_name: None,
        };
    }
    
    let version = match_result.version().unwrap_or_default();
    let table = match_result.table_name().unwrap_or_default();
    
    // Step 4: Validate data against the matched schema
    let schema = match Schema::parse_str(&client_schema_json) {
        Ok(s) => s,
        Err(e) => {
            return ValidationResult {
                valid: false,
                record_count: None,
                error_message: Some(format!("Failed to parse schema: {}", e)),
                schema_version: Some(version),
                table_name: Some(table),
            };
        }
    };
    
    let mut result = validate_with_schema(avro_data, &schema);
    result.schema_version = Some(version);
    result.table_name = Some(table);
    result
}

/// Validate Avro OCF data against an explicit JSON schema string
#[wasm_bindgen]
pub fn validate_avro_ocf(
    avro_data: &[u8],
    schema_json: &str,
) -> ValidationResult {
    utils::set_panic_hook();
    
    let schema = match Schema::parse_str(schema_json) {
        Ok(s) => s,
        Err(e) => {
            return ValidationResult {
                valid: false,
                record_count: None,
                error_message: Some(format!("Failed to parse schema: {}", e)),
                schema_version: None,
                table_name: None,
            };
        }
    };
    
    validate_with_schema(avro_data, &schema)
}

/// Validate Avro OCF data against a specific table schema by name and version
#[wasm_bindgen]
pub fn validate_avro_ocf_by_table(
    avro_data: &[u8],
    table_name: &str,
    version: &str,
) -> ValidationResult {
    utils::set_panic_hook();
    
    // Get the schema for the table from the specified version
    let schema_json = schema_registry::get_schema_json(table_name, version);
    
    // Check if we got an error
    if schema_json.contains("error") {
        return ValidationResult {
            valid: false,
            record_count: None,
            error_message: Some(schema_json),
            schema_version: None,
            table_name: None,
        };
    }
    
    // Parse and validate
    let schema = match Schema::parse_str(&schema_json) {
        Ok(s) => s,
        Err(e) => {
            return ValidationResult {
                valid: false,
                record_count: None,
                error_message: Some(format!("Failed to parse schema: {}", e)),
                schema_version: Some(version.to_string()),
                table_name: Some(table_name.to_string()),
            };
        }
    };
    
    let mut result = validate_with_schema(avro_data, &schema);
    result.table_name = Some(table_name.to_string());
    result.schema_version = Some(version.to_string());
    result
}

fn validate_with_schema(avro_data: &[u8], schema: &Schema) -> ValidationResult {
    // Try to read the Avro file with apache-avro
    let reader = match Reader::with_schema(schema, avro_data) {
        Ok(r) => r,
        Err(e) => {
            return ValidationResult {
                valid: false,
                record_count: None,
                error_message: Some(format!("Failed to create Avro reader: {}", e)),
                schema_version: None,
                table_name: None,
            };
        }
    };
    
    // Count records and validate each one
    let mut count = 0u32;
    for result in reader {
        match result {
            Ok(_value) => {
                count += 1;
            }
            Err(e) => {
                return ValidationResult {
                    valid: false,
                    record_count: Some(count),
                    error_message: Some(format!("Invalid record at position {}: {}", count, e)),
                    schema_version: None,
                    table_name: None,
                };
            }
        }
    }
    
    if count == 0 {
        return ValidationResult {
            valid: false,
            record_count: Some(0),
            error_message: Some("No records found in Avro file".to_string()),
            schema_version: None,
            table_name: None,
        };
    }
    
    ValidationResult {
        valid: true,
        record_count: Some(count),
        error_message: None,
        schema_version: None,
        table_name: None,
    }
}

/// Extract schema JSON from OCF file header
/// Returns the schema as a JSON string if found
fn extract_schema_from_ocf_header(avro_data: &[u8]) -> Option<String> {
    // Look for the "avro.schema" metadata key in the header
    // OCF header format: magic (4 bytes), metadata map, sync marker (16 bytes)
    
    if avro_data.len() < 50 {
        return None;
    }
    
    // Search for the avro.schema key in the header (before the sync marker)
    let search_range = std::cmp::min(avro_data.len(), 8192); // Limit search to first 8KB
    let header_slice = &avro_data[4..search_range]; // Skip magic bytes
    
    let search_bytes = b"avro.schema";
    if let Some(pos) = find_subsequence(header_slice, search_bytes) {
        // Found avro.schema key, now find the schema JSON
        // After the key, there's a length-prefixed string with the JSON schema
        let key_end = pos + search_bytes.len();
        
        // Try to extract JSON schema following the key
        if key_end + 4 < header_slice.len() {
            // Look for the schema JSON value - it typically starts with '{'
            // Search forward for the opening brace
            for i in key_end..std::cmp::min(key_end + 100, header_slice.len()) {
                if header_slice[i] == b'{' {
                    // Found start of JSON, try to extract it
                    return extract_json_from_position(header_slice, i);
                }
            }
        }
    }
    
    None
}

/// Find a subsequence in a slice
fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Extract JSON object starting at a position
fn extract_json_from_position(data: &[u8], start: usize) -> Option<String> {
    if start >= data.len() || data[start] != b'{' {
        return None;
    }
    
    let mut depth = 0;
    let mut end = start;
    let mut in_string = false;
    let mut escape_next = false;
    
    for i in start..data.len() {
        let byte = data[i];
        
        if escape_next {
            escape_next = false;
            continue;
        }
        
        if byte == b'\\' {
            escape_next = true;
            continue;
        }
        
        if byte == b'"' {
            in_string = !in_string;
            continue;
        }
        
        if !in_string {
            if byte == b'{' {
                depth += 1;
            } else if byte == b'}' {
                depth -= 1;
                if depth == 0 {
                    end = i + 1;
                    break;
                }
            }
        }
    }
    
    if depth == 0 && end > start {
        String::from_utf8(data[start..end].to_vec()).ok()
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_magic_bytes_validation() {
        let invalid_data = vec![0x00, 0x00, 0x00, 0x00];
        let result = validate_avro_ocf(&invalid_data, "{}");
        assert!(!result.valid());
    }

    #[test]
    fn test_get_available_versions() {
        let versions = schema_registry::get_available_versions();
        assert!(!versions.is_empty());
        assert!(versions.contains(&"v1".to_string()));
        assert!(versions.contains(&"v2".to_string()));
    }

    #[test]
    fn test_get_available_schemas_v1() {
        let schemas = schema_registry::get_available_schemas("v1");
        assert!(!schemas.is_empty());
    }

    #[test]
    fn test_get_available_schemas_v2() {
        let schemas = schema_registry::get_available_schemas("v2");
        assert!(!schemas.is_empty());
    }
}
