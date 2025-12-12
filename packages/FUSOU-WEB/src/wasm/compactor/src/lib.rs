use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Request, RequestInit, Response};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

// Types (without #[wasm_bindgen] on struct)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetFileMetadata {
    pub dataset_id: String,
    pub uploader_id: String,
    pub table_name: String,
    pub file_path: String,
    pub start_byte: i64,
    pub byte_length: i64,
    pub is_public: bool,
    pub is_compacted: bool,
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

    let mut opts = RequestInit::new();
    opts.method("GET");

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

    let mut opts = RequestInit::new();
    opts.method("GET");

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
pub async fn upload_to_r2(signed_url: &str, data: &[u8]) -> Result<String, JsValue> {
    let mut opts = RequestInit::new();
    opts.method("PUT");

    let headers = web_sys::Headers::new()
        .map_err(|_| JsValue::from_str("Failed to create headers"))?;
    
    opts.set_headers(&headers);
    opts.set_body(Some(&js_sys::Uint8Array::from(data).into()));

    let request = Request::new_with_str_and_init(&signed_url, &opts)
        .map_err(|_| JsValue::from_str("Failed to create request"))?;

    let window = web_sys::window()
        .ok_or_else(|| JsValue::from_str("No window object"))?;

    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|_| JsValue::from_str("Upload failed"))?;

    let resp: Response = resp_value
        .dyn_into()
        .map_err(|_| JsValue::from_str("Failed to convert response"))?;

    if !resp.ok() {
        return Err(JsValue::from_str(&format!("Upload error: {}", resp.status())));
    }

    Ok(format!("Uploaded {} bytes", data.len()))
}

/// Deletes a file from R2
#[wasm_bindgen]
pub async fn delete_from_r2(file_path: &str, r2_url: &str) -> Result<(), JsValue> {
    let url = format!("{}{}", r2_url, file_path);

    let mut opts = RequestInit::new();
    opts.method("DELETE");

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

    let mut opts = RequestInit::new();
    opts.method("POST");

    let headers = web_sys::Headers::new()
        .map_err(|_| JsValue::from_str("Failed to create headers"))?;
    headers
        .append("Authorization", &format!("Bearer {}", supabase_key))
        .map_err(|_| JsValue::from_str("Failed to set auth"))?;
    headers
        .append("Content-Type", "application/json")
        .map_err(|_| JsValue::from_str("Failed to set content-type"))?;
    
    opts.set_headers(&headers);
    opts.set_body(Some(&js_sys::JsValue::from_str(metadata_json)));

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
#[wasm_bindgen]
pub async fn compact_single_dataset(
    dataset_id: &str,
    supabase_url: &str,
    supabase_key: &str,
    r2_url: &str,
) -> Result<String, JsValue> {
    // Guardrails from env
    // Dynamic limit tuning: prefer smaller caps if many fragments detected
    let max_fragments: usize = js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("COMPACT_MAX_FRAGMENTS"))
        .ok()
        .and_then(|v| v.as_string())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(8);
    let max_bytes: usize = js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("COMPACT_MAX_BYTES"))
        .ok()
        .and_then(|v| v.as_string())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(25 * 1024 * 1024);

    // Fetch metadata from Supabase
    let metadata_json = fetch_dataset_metadata(dataset_id, supabase_url, supabase_key).await?;
    let metadata_str = metadata_json
        .as_string()
        .ok_or_else(|| JsValue::from_str("Failed to convert metadata to string"))?;

    let metadata_list: Vec<DatasetFileMetadata> = serde_json::from_str(&metadata_str)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse metadata: {}", e)))?;

    if metadata_list.is_empty() {
        return Ok("No files to compact".to_string());
    }

    // Group by table name
    let mut table_groups: HashMap<String, Vec<DatasetFileMetadata>> = HashMap::new();
    for metadata in &metadata_list {
        table_groups
            .entry(metadata.table_name.clone())
            .or_insert_with(Vec::new)
            .push(metadata.clone());
    }

    // Process each table
    let mut compacted_count = 0;

    for (table_name, group) in table_groups {
        // Download and extract fragments
        let mut fragments: Vec<Vec<u8>> = Vec::new();
        let mut total_bytes: usize = 0;
        let mut processed = 0;

        let group_len = group.len();
        // If too many fragments, reduce caps to be safer
        let frag_cap = if group_len > 20 { max_fragments.saturating_sub(4) } else { max_fragments };
        let byte_cap = if group_len > 20 { max_bytes / 2 } else { max_bytes };
        
        for metadata in &group {
            let file_data = download_from_r2(&metadata.file_path, r2_url).await?;
            let fragment = extract_parquet_fragment(
                &file_data,
                metadata.start_byte as usize,
                metadata.byte_length as usize,
            )?;
            // Apply caps
            if processed >= frag_cap { break; }
            if total_bytes + fragment.len() > byte_cap { break; }
            total_bytes += fragment.len();
            fragments.push(fragment);
            processed += 1;
        }

        // Merge fragments (concatenate for MVP) with chunked assembly to reduce peak memory.
        let mut merged = Vec::with_capacity(total_bytes);
        for fragment in fragments {
            // Append in 1MB chunks
            const CHUNK: usize = 1024 * 1024;
            let mut offset = 0;
            while offset < fragment.len() {
                let end = (offset + CHUNK).min(fragment.len());
                merged.extend_from_slice(&fragment[offset..end]);
                offset = end;
            }
        }

        // Upload merged file
        let file_id = uuid::Uuid::new_v4();
        let output_path = format!("optimized/{}/{}-{}.parquet", dataset_id, table_name, file_id);
        // Request presigned URL from API to avoid exposing raw R2 URL
        let sign_api = format!("{}/api/r2/sign", js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("API_BASE")).ok()
            .and_then(|v| v.as_string()).unwrap_or_else(|| "".to_string()));
        let signed_url = if !sign_api.is_empty() {
            // Call sign API
            let mut init = RequestInit::new();
            init.method("POST");
            let payload = serde_json::json!({"path": output_path, "operation": "put"});
            init.set_body(Some(&JsValue::from_str(&payload.to_string())));
            let req = Request::new_with_str_and_init(&sign_api, &init).map_err(|_| JsValue::from_str("sign req"))?;
            let win = web_sys::window().ok_or_else(|| JsValue::from_str("No window"))?;
            let resp_value = JsFuture::from(win.fetch_with_request(&req)).await.map_err(|_| JsValue::from_str("sign fetch"))?;
            let resp: Response = resp_value.dyn_into().map_err(|_| JsValue::from_str("sign resp"))?;
            let text = JsFuture::from(resp.text().map_err(|_| JsValue::from_str("sign text"))?).await.map_err(|_| JsValue::from_str("sign await"))?;
            let s = text.as_string().ok_or_else(|| JsValue::from_str("sign str"))?;
            let v: serde_json::Value = serde_json::from_str(&s).map_err(|_| JsValue::from_str("sign json"))?;
            v.get("url").and_then(|u| u.as_str()).unwrap_or(&format!("{}{}", r2_url, output_path)).to_string()
        } else {
            format!("{}{}", r2_url, output_path)
        };

        upload_to_r2(&signed_url, &merged).await?;

        // Update Supabase
        let new_metadata = serde_json::json!({
            "dataset_id": dataset_id,
            "uploader_id": &group[0].uploader_id,
            "table_name": table_name,
            "file_path": output_path,
            "start_byte": 0,
            "byte_length": merged.len() as i64,
            "is_public": group[0].is_public,
            "is_compacted": true,
        });

        update_supabase_metadata(
            dataset_id,
            &table_name,
            &new_metadata.to_string(),
            supabase_url,
            supabase_key,
        )
        .await?;

        // Delete old files
        for metadata in &group {
            let _ = delete_from_r2(&metadata.file_path, r2_url).await;
        }

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
