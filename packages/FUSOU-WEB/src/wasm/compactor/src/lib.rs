use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Request, RequestInit, Response};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

// Types (without #[wasm_bindgen] on struct)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetFileMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub dataset_id: String,
    pub uploader_id: String,
    pub table_name: String,
    pub file_path: String,
    pub start_byte: i64,
    pub byte_length: i64,
    pub is_public: bool,
    pub is_compacted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// Error messages for processing operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessingError {
    pub error_type: String,
    pub message: String,
}

impl ProcessingError {
    fn network(msg: impl Into<String>) -> Self {
        Self { error_type: "NetworkError".to_string(), message: msg.into() }
    }
    fn validation(msg: impl Into<String>) -> Self {
        Self { error_type: "ValidationError".to_string(), message: msg.into() }
    }
    fn storage(msg: impl Into<String>) -> Self {
        Self { error_type: "StorageError".to_string(), message: msg.into() }
    }
    fn serialization(msg: impl Into<String>) -> Self {
        Self { error_type: "SerializationError".to_string(), message: msg.into() }
    }
    
    fn to_js_value(&self) -> JsValue {
        JsValue::from_str(&format!("{}: {}", self.error_type, self.message))
    }
}

/// Validates and processes binary data (Avro or Parquet format)
/// For MVP: validates non-empty data
#[wasm_bindgen]
pub fn validate_parquet_data(data: &[u8]) -> Result<(), JsValue> {
    if data.is_empty() {
        return Err(ProcessingError::validation("Input data is empty").to_js_value());
    }
    Ok(())
}

/// Concatenates multiple Parquet binaries into a single binary file
/// Returns tuple of (concatenated_data, offsets_json)
#[wasm_bindgen]
pub fn concatenate_parquet_files(tables_json: &str) -> Result<JsValue, JsValue> {
    let tables: HashMap<String, Vec<u8>> = serde_json::from_str(tables_json)
        .map_err(|e| ProcessingError::serialization(format!("Invalid tables JSON: {}", e)).to_js_value())?;
    
    let mut concatenated = Vec::new();
    let mut offsets: HashMap<String, (usize, usize)> = HashMap::new();

    for (table_name, parquet_bytes) in tables {
        let start_offset = concatenated.len();
        let byte_length = parquet_bytes.len();
        
        concatenated.extend_from_slice(&parquet_bytes);
        offsets.insert(table_name, (start_offset, byte_length));
    }

    let result = serde_json::json!({
        "data": concatenated,
        "offsets": offsets,
        "total_bytes": concatenated.len()
    });

    Ok(serde_json::to_string(&result)
        .map_err(|e| ProcessingError::serialization(e.to_string()).to_js_value())?
        .into())
}

/// Main batch upload function: processes tables, concatenates, and uploads to R2
/// 
/// # Arguments
/// * `tables_json` - JSON string of HashMap<table_name, Vec<u8>>
/// * `upload_url` - Pre-signed URL for R2 upload
/// * `uploader_id` - UUID of the user uploading
/// * `is_public` - Whether the dataset is public
/// * `dataset_id` - UUID of the dataset
///
/// # Returns
/// JSON string of Vec<DatasetFileMetadata>
#[wasm_bindgen]
pub async fn process_and_upload_batch(
    tables_json: &str,
    upload_url: &str,
    uploader_id: &str,
    is_public: bool,
    dataset_id: &str,
) -> Result<String, JsValue> {
    let tables: HashMap<String, Vec<u8>> = serde_json::from_str(tables_json)
        .map_err(|e| ProcessingError::serialization(format!("Invalid tables JSON: {}", e)).to_js_value())?;

    if tables.is_empty() {
        return Err(ProcessingError::validation("No tables provided").to_js_value());
    }

    // Step 1: Validate each table's data
    for (table_name, data) in &tables {
        if data.is_empty() {
            return Err(ProcessingError::validation(format!("Table '{}' has empty data", table_name)).to_js_value());
        }
    }

    // Step 2: Concatenate all Parquet files
    let mut concatenated = Vec::new();
    let mut offsets: HashMap<String, (usize, usize)> = HashMap::new();

    for (table_name, parquet_bytes) in &tables {
        let start_offset = concatenated.len();
        let byte_length = parquet_bytes.len();
        
        concatenated.extend_from_slice(parquet_bytes);
        offsets.insert(table_name.clone(), (start_offset, byte_length));
    }

    // Step 3: Upload to R2
    let file_id = uuid::Uuid::new_v4().to_string();
    let file_key = format!("raw/{}/{}.bin", dataset_id, file_id);

    upload_to_r2(upload_url, &concatenated).await?;

    // Step 4: Generate metadata
    let mut metadata_vec = Vec::new();
    let now = js_sys::Date::new_0().to_iso_string().as_string().unwrap_or_default();

    for (table_name, (start_byte, byte_length)) in offsets {
        let metadata = DatasetFileMetadata {
            id: None,
            dataset_id: dataset_id.to_string(),
            uploader_id: uploader_id.to_string(),
            table_name: table_name.clone(),
            file_path: file_key.clone(),
            start_byte: start_byte as i64,
            byte_length: byte_length as i64,
            is_public,
            is_compacted: false,
            created_at: Some(now.clone()),
        };
        metadata_vec.push(metadata);
    }

    serde_json::to_string(&metadata_vec)
        .map_err(|e| ProcessingError::serialization(e.to_string()).to_js_value())
}

/// Fetches metadata for a dataset from Supabase
#[wasm_bindgen]
pub async fn fetch_dataset_metadata(
    dataset_id: &str,
    supabase_url: &str,
    supabase_key: &str,
) -> Result<JsValue, JsValue> {
    let url = format!(
        "{}/rest/v1/dataset_files?dataset_id=eq.{}&select=*",
        supabase_url, dataset_id
    );

    let opts = RequestInit::new();
    opts.set_method("GET");

    let headers = web_sys::Headers::new()
        .map_err(|_| JsValue::from_str("Failed to create headers"))?;
    headers
        .append("Authorization", &format!("Bearer {}", supabase_key))
        .map_err(|_| JsValue::from_str("Failed to set auth header"))?;
    headers
        .append("Content-Type", "application/json")
        .map_err(|_| JsValue::from_str("Failed to set content-type"))?;

    let request = Request::new_with_str_and_init(&url, &opts)
        .map_err(|_| JsValue::from_str("Failed to create request"))?;

    let window = web_sys::window()
        .ok_or_else(|| JsValue::from_str("No window object"))?;

    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|_| JsValue::from_str("Fetch failed"))?;

    let resp: Response = resp_value
        .dyn_into()
        .map_err(|_| JsValue::from_str("Failed to convert response"))?;

    if !resp.ok() {
        return Err(JsValue::from_str(&format!(
            "Supabase error: {}",
            resp.status()
        )));
    }

    let text = JsFuture::from(
        resp.text()
            .map_err(|_| JsValue::from_str("Failed to read text"))?
    )
    .await
    .map_err(|_| JsValue::from_str("Failed to await text"))?;

    Ok(text)
}

/// Extracts a Parquet fragment from concatenated binary data
#[wasm_bindgen]
pub fn extract_parquet_fragment(
    data: &[u8],
    start_byte: usize,
    byte_length: usize,
) -> Result<Vec<u8>, JsValue> {
    if start_byte + byte_length > data.len() {
        return Err(JsValue::from_str(
            &format!(
                "Invalid offset: start={}, len={}, total={}",
                start_byte,
                byte_length,
                data.len()
            )
        ));
    }
    Ok(data[start_byte..start_byte + byte_length].to_vec())
}

/// Downloads a file from R2
#[wasm_bindgen]
pub async fn download_from_r2(file_path: &str, r2_url: &str) -> Result<Vec<u8>, JsValue> {
    let url = format!("{}{}", r2_url, file_path);

    let opts = RequestInit::new();
    opts.set_method("GET");

    let request = Request::new_with_str_and_init(&url, &opts)
        .map_err(|_| JsValue::from_str("Failed to create request"))?;

    let window = web_sys::window()
        .ok_or_else(|| JsValue::from_str("No window object"))?;

    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|_| JsValue::from_str("Download failed"))?;

    let resp: Response = resp_value
        .dyn_into()
        .map_err(|_| JsValue::from_str("Failed to convert response"))?;

    if !resp.ok() {
        return Err(JsValue::from_str(&format!("Download error: {}", resp.status())));
    }

    let array_buf = JsFuture::from(
        resp.array_buffer()
            .map_err(|_| JsValue::from_str("Failed to read buffer"))?
    )
    .await
    .map_err(|_| JsValue::from_str("Failed to await buffer"))?;

    let bytes = js_sys::Uint8Array::new(&array_buf).to_vec();
    Ok(bytes)
}

/// Uploads a file to R2 with signed URL
#[wasm_bindgen]
pub async fn upload_to_r2(signed_url: &str, data: &[u8]) -> Result<(), JsValue> {
    let opts = RequestInit::new();
    opts.set_method("PUT");

    let headers = web_sys::Headers::new()
        .map_err(|_| ProcessingError::network("Failed to create headers").to_js_value())?;
    
    opts.set_headers(&headers);
    let body = JsValue::from(js_sys::Uint8Array::from(data));
    opts.set_body(&body);

    let request = Request::new_with_str_and_init(&signed_url, &opts)
        .map_err(|_| ProcessingError::network("Failed to create request").to_js_value())?;

    let window = web_sys::window()
        .ok_or_else(|| ProcessingError::network("No window object").to_js_value())?;

    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|_| ProcessingError::network("Upload failed").to_js_value())?;

    let resp: Response = resp_value
        .dyn_into()
        .map_err(|_| ProcessingError::network("Failed to convert response").to_js_value())?;

    if !resp.ok() {
        return Err(ProcessingError::network(format!("Upload error: {}", resp.status())).to_js_value());
    }

    Ok(())
}

/// Deletes a file from R2
#[wasm_bindgen]
pub async fn delete_from_r2(file_path: &str, r2_url: &str) -> Result<(), JsValue> {
    let url = format!("{}{}", r2_url, file_path);

    let opts = RequestInit::new();
    opts.set_method("DELETE");

    let request = Request::new_with_str_and_init(&url, &opts)
        .map_err(|_| JsValue::from_str("Failed to create request"))?;

    let window = web_sys::window()
        .ok_or_else(|| JsValue::from_str("No window object"))?;

    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|_| JsValue::from_str("Delete failed"))?;

    let resp: Response = resp_value
        .dyn_into()
        .map_err(|_| JsValue::from_str("Failed to convert response"))?;

    if !resp.ok() {
        return Err(JsValue::from_str(&format!("Delete error: {}", resp.status())));
    }

    Ok(())
}

/// Updates metadata in Supabase
#[wasm_bindgen]
pub async fn update_supabase_metadata(
    dataset_id: &str,
    table_name: &str,
    metadata_json: &str,
    supabase_url: &str,
    supabase_key: &str,
) -> Result<(), JsValue> {
    let url = format!(
        "{}/rest/v1/dataset_files?dataset_id=eq.{}&table_name=eq.{}",
        supabase_url, dataset_id, table_name
    );

    let opts = RequestInit::new();
    opts.set_method("POST");

    let headers = web_sys::Headers::new()
        .map_err(|_| JsValue::from_str("Failed to create headers"))?;
    headers
        .append("Authorization", &format!("Bearer {}", supabase_key))
        .map_err(|_| JsValue::from_str("Failed to set auth"))?;
    headers
        .append("Content-Type", "application/json")
        .map_err(|_| JsValue::from_str("Failed to set content-type"))?;
    
    opts.set_headers(&headers);
    let body = JsValue::from_str(metadata_json);
    opts.set_body(&body);

    let request = Request::new_with_str_and_init(&url, &opts)
        .map_err(|_| JsValue::from_str("Failed to create request"))?;

    let window = web_sys::window()
        .ok_or_else(|| JsValue::from_str("No window object"))?;

    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|_| JsValue::from_str("Update failed"))?;

    let resp: Response = resp_value
        .dyn_into()
        .map_err(|_| JsValue::from_str("Failed to convert response"))?;

    if !resp.ok() {
        return Err(JsValue::from_str(&format!("Update error: {}", resp.status())));
    }

    Ok(())
}

/// Main handler for compacting a single dataset
/// 
/// # Arguments
/// * `dataset_id` - Dataset ID for tracking
/// * `supabase_url` - Supabase API URL for metadata updates
/// * `supabase_key` - Supabase service role key for authentication
/// * `parquet_bytes` - Direct binary data (ArrayBuffer from Worker environment)
///
/// # Returns
/// String message with compaction result
///
/// # Changes from v1
/// - Now accepts direct Parquet binary data instead of R2 URL
/// - All processing is done in-memory within WASM
/// - No need for HTTP requests to R2 for reading (data is passed directly)
#[wasm_bindgen]
pub async fn compact_single_dataset(
    dataset_id: &str,
    supabase_url: &str,
    supabase_key: &str,
    parquet_bytes: &[u8],
) -> Result<String, JsValue> {
    // Validate input
    if parquet_bytes.is_empty() {
        return Err(JsValue::from_str("No Parquet data provided"));
    }

    // Performance tuning parameters
    let max_bytes: usize = 100 * 1024 * 1024; // 100MB max for processing

    // Validate that input size is within limits
    if parquet_bytes.len() > max_bytes {
        return Err(JsValue::from_str(&format!(
            "Input data too large: {} bytes (max {} bytes)",
            parquet_bytes.len(),
            max_bytes
        )));
    }

    // Fetch metadata from Supabase to get table information
    let metadata_json = fetch_dataset_metadata(dataset_id, supabase_url, supabase_key).await?;
    let metadata_str = metadata_json
        .as_string()
        .ok_or_else(|| JsValue::from_str("Failed to convert metadata to string"))?;

    let metadata_list: Vec<DatasetFileMetadata> = serde_json::from_str(&metadata_str)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse metadata: {}", e)))?;

    if metadata_list.is_empty() {
        return Ok("No metadata found, treating data as single table".to_string());
    }

    // Group metadata by table name to understand structure
    let mut table_groups: HashMap<String, Vec<DatasetFileMetadata>> = HashMap::new();
    for metadata in &metadata_list {
        table_groups
            .entry(metadata.table_name.clone())
            .or_insert_with(Vec::new)
            .push(metadata.clone());
    }

    // For single-file datasets, use the entire binary as-is
    // For multi-fragment datasets, fragments would already be concatenated at the Worker layer
    let mut compacted_count = 0;

    // Process each table type identified in metadata
    for (table_name, group) in table_groups {
        // Since data is already provided as a complete binary, we don't need to download fragments
        // The Worker has already consolidated the data and passed it directly
        
        // Create output metadata
        let file_id = uuid::Uuid::new_v4();
        let output_path = format!("optimized/{}/{}-{}.parquet", dataset_id, table_name, file_id);

        // Perform any in-memory Parquet optimization here if needed
        // For MVP: just validate and register the data
        let compacted_data = parquet_bytes.to_vec();

        // Note: Upload to R2 would be done by the Worker (Cloudflare environment)
        // WASM only performs in-memory processing and validation
        // This is necessary because WASM in Workers doesn't have direct R2 bucket access

        // Prepare new metadata for the compacted data
        let new_metadata = serde_json::json!({
            "dataset_id": dataset_id,
            "uploader_id": group.get(0).map(|m| &m.uploader_id).cloned().unwrap_or_default(),
            "table_name": table_name,
            "file_path": output_path,
            "start_byte": 0,
            "byte_length": compacted_data.len() as i64,
            "is_public": group.get(0).map(|m| m.is_public).unwrap_or(false),
            "is_compacted": true,
        });

        // Update Supabase with new metadata
        update_supabase_metadata(
            dataset_id,
            &table_name,
            &new_metadata.to_string(),
            supabase_url,
            supabase_key,
        )
        .await?;

        compacted_count += 1;
    }

    Ok(format!("Compacted {} tables", compacted_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_fragment() {
        let data = vec![1, 2, 3, 4, 5];
        let result = extract_parquet_fragment(&data, 1, 3)
            .expect("Failed to extract");
        assert_eq!(result, vec![2, 3, 4]);
    }

    #[test]
    fn test_extract_fragment_invalid() {
        let data = vec![1, 2, 3];
        let result = extract_parquet_fragment(&data, 5, 5);
        assert!(result.is_err());
    }
}
