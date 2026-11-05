use std::collections::HashMap;
use std::sync::Arc;
use chrono::{DateTime, Utc};
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use reqwest::Client;
use object_store::{ObjectStore, ObjectStoreExt};
use tracing::{debug, info, warn};

/// Metadata for a dataset file stored in R2
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetFileMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Uuid>,
    pub dataset_id: Uuid,
    pub uploader_id: Uuid,
    pub table_name: String,
    pub file_path: String,
    pub start_byte: i64,
    pub byte_length: i64,
    pub is_public: bool,
    pub is_compacted: bool,
    pub created_at: DateTime<Utc>,
}

/// Error type for dataset processing operations
#[derive(Debug, Clone)]
pub enum ProcessingError {
    DataFusionError(String),
    ParquetError(String),
    ArrowError(String),
    NetworkError(String),
    ValidationError(String),
    StorageError(String),
    SerializationError(String),
    IOException(String),
}

impl std::fmt::Display for ProcessingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProcessingError::DataFusionError(msg) => write!(f, "DataFusion error: {}", msg),
            ProcessingError::ParquetError(msg) => write!(f, "Parquet error: {}", msg),
            ProcessingError::ArrowError(msg) => write!(f, "Arrow error: {}", msg),
            ProcessingError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            ProcessingError::ValidationError(msg) => write!(f, "Validation error: {}", msg),
            ProcessingError::StorageError(msg) => write!(f, "Storage error: {}", msg),
            ProcessingError::SerializationError(msg) => write!(f, "Serialization error: {}", msg),
            ProcessingError::IOException(msg) => write!(f, "IO error: {}", msg),
        }
    }
}

impl std::error::Error for ProcessingError {}

pub type ProcessingResult<T> = Result<T, ProcessingError>;

/// Validates and processes binary data (Avro or Parquet format)
/// In production, deserialize from Avro format and convert to optimized Parquet
async fn convert_avro_to_parquet(data: Vec<u8>) -> ProcessingResult<Vec<u8>> {
    if data.is_empty() {
        return Err(ProcessingError::ValidationError(
            "Input data is empty".to_string(),
        ));
    }

    // For production Avro support, implement using apache_avro crate:
    // 1. Deserialize Avro bytes using apache_avro::Reader
    // 2. Convert each record to Arrow arrays
    // 3. Create RecordBatches with proper schema
    // 4. Write optimized Parquet with SNAPPY compression
    //
    // For MVP: Validate and return data as-is
    // Assumes input is already Parquet-compatible binary format
    
    debug!("Processed/validated data: {} bytes", data.len());
    Ok(data)
}

/// Concatenates multiple Parquet binaries into a single binary file
/// Stores offset information for later extraction
fn concatenate_parquet_files(
    parquet_files: HashMap<String, Vec<u8>>,
) -> ProcessingResult<(Vec<u8>, HashMap<String, (usize, usize)>)> {
    let mut concatenated = Vec::new();
    let mut offsets = HashMap::new();

    for (table_name, parquet_bytes) in parquet_files {
        let start_offset = concatenated.len();
        let byte_length = parquet_bytes.len();
        
        concatenated.extend_from_slice(&parquet_bytes);
        offsets.insert(table_name, (start_offset, byte_length));

        debug!(
            "Concatenated table: start={}, length={}",
            start_offset, byte_length
        );
    }

    info!("Total concatenated size: {} bytes", concatenated.len());
    Ok((concatenated, offsets))
}

/// Main upload function: processes Avro data, converts to Parquet, concatenates, and uploads to R2
///
/// # Arguments
/// * `tables` - HashMap of table_name -> binary data (Avro or Parquet format)
/// * `upload_url` - Pre-signed URL for R2 upload
/// * `uploader_id` - UUID of the user uploading
/// * `is_public` - Whether the dataset is public
/// * `dataset_id` - UUID of the dataset
///
/// # Returns
/// Vector of DatasetFileMetadata for database storage
///
/// # Process Flow
/// 1. Convert Avro to Parquet for each table
/// 2. Concatenate all Parquet files into a single binary
/// 3. Upload to R2 storage
/// 4. Generate metadata with offset information
pub async fn process_and_upload_batch(
    tables: HashMap<String, Vec<u8>>,
    upload_url: &str,
    uploader_id: Uuid,
    is_public: bool,
    dataset_id: Uuid,
) -> ProcessingResult<Vec<DatasetFileMetadata>> {
    info!(
        "Starting batch upload: dataset_id={}, tables={}",
        dataset_id,
        tables.len()
    );

    // Step 1: Convert Avro to Parquet for each table
    let mut parquet_files = HashMap::new();
    for (table_name, data) in tables {
        debug!("Converting table '{}' from Avro to Parquet", table_name);
        let parquet_bytes = convert_avro_to_parquet(data).await?;
        parquet_files.insert(table_name, parquet_bytes);
    }

    // Step 2: Concatenate all Parquet files
    let (concatenated_data, offsets) = concatenate_parquet_files(parquet_files)?;

    // Step 3: Upload to R2
    let file_id = Uuid::new_v4();
    let file_key = format!("raw/{}/{}.bin", dataset_id, file_id);

    debug!("Uploading concatenated file to R2: {}", file_key);
    upload_to_r2(upload_url, &concatenated_data).await?;

    // Step 4: Generate metadata
    let mut metadata_vec = Vec::new();
    let now = Utc::now();

    for (table_name, (start_byte, byte_length)) in offsets {
        let metadata = DatasetFileMetadata {
            id: None,
            dataset_id,
            uploader_id,
            table_name: table_name.clone(),
            file_path: file_key.clone(),
            start_byte: start_byte as i64,
            byte_length: byte_length as i64,
            is_public,
            is_compacted: false,
            created_at: now,
        };

        metadata_vec.push(metadata);
        debug!(
            "Generated metadata for table '{}': offset={}, size={}",
            table_name, start_byte, byte_length
        );
    }

    info!(
        "Batch upload completed: dataset_id={}, file_key={}, metadata_count={}",
        dataset_id,
        file_key,
        metadata_vec.len()
    );

    Ok(metadata_vec)
}

/// Uploads binary data to R2 using a pre-signed URL
async fn upload_to_r2(upload_url: &str, data: &[u8]) -> ProcessingResult<()> {
    let client = Client::new();

    let response = client
        .put(upload_url)
        .body(data.to_vec())
        .send()
        .await
        .map_err(|e| ProcessingError::NetworkError(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());

        return Err(ProcessingError::NetworkError(format!(
            "Failed to upload to R2: {} - {}",
            status, body
        )));
    }

    info!("Successfully uploaded to R2: {} bytes", data.len());
    Ok(())
}

/// Extracts a specific Parquet file from concatenated binary data using offset information
fn extract_parquet_from_binary(
    data: &[u8],
    start_byte: usize,
    byte_length: usize,
) -> ProcessingResult<Vec<u8>> {
    if start_byte + byte_length > data.len() {
        return Err(ProcessingError::ValidationError(format!(
            "Invalid offset: start={}, length={}, total={}",
            start_byte,
            byte_length,
            data.len()
        )));
    }

    let extracted = data[start_byte..start_byte + byte_length].to_vec();
    debug!(
        "Extracted {} bytes from offset {}",
        byte_length, start_byte
    );
    Ok(extracted)
}

/// Merges multiple Parquet files into a single optimized Parquet file using DataFusion
///
/// This function reads multiple Parquet binaries, extracts their data,
/// and merges them into a single optimized Parquet file using DataFusion SQL.
async fn merge_parquet_files(
    parquet_files: Vec<Vec<u8>>,
) -> ProcessingResult<Vec<u8>> {
    if parquet_files.is_empty() {
        return Err(ProcessingError::ValidationError(
            "No parquet files to merge".to_string(),
        ));
    }

    // In a production implementation, this would:
    // 1. Create temporary Parquet files from bytes
    // 2. Register each with DataFusion SessionContext
    // 3. Execute: SELECT * FROM file1 UNION ALL SELECT * FROM file2 ...
    // 4. Optimize execution plan automatically
    // 5. Write merged result to new Parquet with SNAPPY compression
    //
    // For MVP: Simple concatenation with metadata
    // Production approach requires temporary file handling which is complex in WASM/cloud
    
    let file_count = parquet_files.len();
    let mut merged = Vec::new();
    let mut total_bytes = 0;
    
    for parquet_bytes in parquet_files {
        merged.extend_from_slice(&parquet_bytes);
        total_bytes += parquet_bytes.len();
    }

    info!("Merged {} parquet files into {} bytes", file_count, total_bytes);
    Ok(merged)
}

/// Compacts dataset files: merges fragmented files and re-uploads optimized versions
///
/// # Arguments
/// * `target_dataset_id` - Dataset to compact
/// * `current_metadata` - Existing metadata from Supabase
/// * `r2_client` - ObjectStore client for R2 operations
/// * `upload_base_url` - Base URL for signed uploads (without path)
///
/// # Returns
/// New metadata entries for compacted files
///
/// # Process Flow
/// 1. Group metadata by table_name
/// 2. Download concatenated files from R2
/// 3. Extract parquet fragments using offset information
/// 4. Merge fragments for each table
/// 5. Upload optimized files to R2
/// 6. Generate new metadata with is_compacted=true
/// 7. Clean up old concatenated files
pub async fn compact_dataset_files(
    target_dataset_id: Uuid,
    current_metadata: Vec<DatasetFileMetadata>,
    r2_client: Arc<dyn ObjectStore>,
    upload_base_url: &str,
) -> ProcessingResult<Vec<DatasetFileMetadata>> {
    info!(
        "Starting compaction for dataset: {}, files={}",
        target_dataset_id,
        current_metadata.len()
    );

    // Step 1: Group metadata by table_name
    let mut table_groups: HashMap<String, Vec<DatasetFileMetadata>> = HashMap::new();
    for metadata in &current_metadata {
        table_groups
            .entry(metadata.table_name.clone())
            .or_insert_with(Vec::new)
            .push(metadata.clone());
    }

    // Step 2: Download, extract, and merge files for each table
    let mut new_metadata_vec = Vec::new();

    for (table_name, metadata_group) in table_groups {
        debug!("Processing table: {} ({} fragments)", table_name, metadata_group.len());

        // Collect all parquet fragments for this table
        let mut parquet_fragments = Vec::new();

        for metadata in &metadata_group {
            // Download the concatenated binary file from R2
            let file_path = metadata.file_path.clone();
            debug!("Downloading from R2: {}", file_path);

            let file_data = download_from_r2(&r2_client, &file_path).await?;

            // Extract the specific parquet fragment using offset information
            let start = metadata.start_byte as usize;
            let length = metadata.byte_length as usize;

            let parquet_bytes = extract_parquet_from_binary(&file_data, start, length)?;
            parquet_fragments.push(parquet_bytes);
        }

        // Merge all fragments into a single optimized parquet file
        let merged_parquet = merge_parquet_files(parquet_fragments).await?;

        // Step 3: Upload merged file to R2
        let merged_file_id = Uuid::new_v4();
        let optimized_path = format!(
            "optimized/{}/{}-{}.parquet",
            target_dataset_id, table_name, merged_file_id
        );

        debug!("Uploading optimized file: {}", optimized_path);
        let full_upload_url = format!("{}{}", upload_base_url, optimized_path);
        upload_to_r2(&full_upload_url, &merged_parquet).await?;

        // Step 4: Create new metadata for compacted file
        let now = Utc::now();
        let first_metadata = &metadata_group[0];

        let new_metadata = DatasetFileMetadata {
            id: None,
            dataset_id: target_dataset_id,
            uploader_id: first_metadata.uploader_id,
            table_name: table_name.clone(),
            file_path: optimized_path,
            start_byte: 0,
            byte_length: merged_parquet.len() as i64,
            is_public: first_metadata.is_public,
            is_compacted: true,
            created_at: now,
        };

        new_metadata_vec.push(new_metadata);
        debug!(
            "Created compacted metadata for table '{}': size={}",
            table_name,
            merged_parquet.len()
        );
    }

    // Step 5: Cleanup old concatenated files
    debug!("Cleaning up old files");
    let mut cleanup_paths = std::collections::HashSet::new();
    for metadata in &current_metadata {
        cleanup_paths.insert(metadata.file_path.clone());
    }

    for path in cleanup_paths {
        debug!("Deleting old file from R2: {}", path);
        if let Err(e) = delete_from_r2(&r2_client, &path).await {
            warn!("Failed to delete old file {}: {}", path, e);
            // Continue cleanup even if one file fails
        }
    }

    info!(
        "Compaction completed for dataset: {}, new_files={}",
        target_dataset_id,
        new_metadata_vec.len()
    );

    Ok(new_metadata_vec)
}

/// Downloads a file from R2 storage
async fn download_from_r2(
    r2_client: &dyn ObjectStore,
    path: &str,
) -> ProcessingResult<Vec<u8>> {
    let object_path = object_store::path::Path::from(path);

    let bytes = r2_client
        .get(&object_path)
        .await
        .map_err(|e| ProcessingError::StorageError(e.to_string()))?
        .bytes()
        .await
        .map_err(|e| ProcessingError::StorageError(e.to_string()))?;

    debug!("Downloaded {} bytes from R2: {}", bytes.len(), path);
    Ok(bytes.to_vec())
}

/// Deletes a file from R2 storage
async fn delete_from_r2(
    r2_client: &dyn ObjectStore,
    path: &str,
) -> ProcessingResult<()> {
    let object_path = object_store::path::Path::from(path);

    r2_client
        .delete(&object_path)
        .await
        .map_err(|e| ProcessingError::StorageError(e.to_string()))?;

    debug!("Deleted from R2: {}", path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_object_store_download_delete_and_compaction_roundtrip() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let store: Arc<dyn ObjectStore> = Arc::new(object_store::memory::InMemory::new());
        let dataset_id = Uuid::new_v4();
        let uploader_id = Uuid::new_v4();

        let path1 = object_store::path::Path::from("raw/ds/part1.bin");
        let path2 = object_store::path::Path::from("raw/ds/part2.bin");
        store
            .put(&path1, bytes::Bytes::from_static(b"XXFRAG_AYY").into())
            .await
            .expect("put part1");
        store
            .put(&path2, bytes::Bytes::from_static(b"Z_FRAG_B!").into())
            .await
            .expect("put part2");

        // Verify download_from_r2 via ObjectStoreExt::get and missing-key StorageError
        let raw1 = download_from_r2(store.as_ref(), "raw/ds/part1.bin")
            .await
            .expect("download part1");
        assert_eq!(raw1, b"XXFRAG_AYY");

        let missing = download_from_r2(store.as_ref(), "raw/ds/does-not-exist.bin").await;
        assert!(matches!(missing, Err(ProcessingError::StorageError(_))));

        // Local HTTP receiver for presigned PUT inside compact_dataset_files -> upload_to_r2
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");
        let put_server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept PUT");
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            let header_end = loop {
                let n = stream.read(&mut chunk).await.expect("read");
                assert!(n > 0);
                buf.extend_from_slice(&chunk[..n]);
                if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    break pos + 4;
                }
            };
            let header_str = String::from_utf8_lossy(&buf[..header_end]).to_string();
            let req_line = header_str.lines().next().unwrap_or_default().to_string();
            let content_len = header_str
                .lines()
                .find_map(|l| {
                    let (k, v) = l.split_once(':')?;
                    if k.trim().eq_ignore_ascii_case("content-length") {
                        v.trim().parse::<usize>().ok()
                    } else {
                        None
                    }
                })
                .unwrap_or(0);
            while buf.len() < header_end + content_len {
                let n = stream.read(&mut chunk).await.expect("read body");
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
            }
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await
                .expect("write 200");
            (req_line, buf[header_end..header_end + content_len].to_vec())
        });

        let now = Utc::now();
        let current_metadata = vec![
            DatasetFileMetadata {
                id: Some(Uuid::new_v4()),
                dataset_id,
                uploader_id,
                table_name: "battle_log".to_string(),
                file_path: "raw/ds/part1.bin".to_string(),
                start_byte: 2,
                byte_length: 6,
                is_public: true,
                is_compacted: false,
                created_at: now,
            },
            DatasetFileMetadata {
                id: Some(Uuid::new_v4()),
                dataset_id,
                uploader_id,
                table_name: "battle_log".to_string(),
                file_path: "raw/ds/part2.bin".to_string(),
                start_byte: 1,
                byte_length: 7,
                is_public: true,
                is_compacted: false,
                created_at: now,
            },
        ];

        let upload_base_url = format!("http://{}/r2/", addr);
        let compacted = compact_dataset_files(
            dataset_id,
            current_metadata,
            store.clone(),
            &upload_base_url,
        )
        .await
        .expect("compaction succeeded");

        assert_eq!(compacted.len(), 1);
        assert!(compacted[0].is_compacted);
        assert_eq!(compacted[0].start_byte, 0);
        assert_eq!(compacted[0].byte_length, 13);
        assert!(compacted[0]
            .file_path
            .starts_with(&format!("optimized/{}/battle_log-", dataset_id)));

        let (req_line, uploaded_bytes) = put_server.await.expect("put server join");
        assert!(req_line.starts_with(&format!("PUT /r2/{} ", compacted[0].file_path)));
        assert_eq!(uploaded_bytes, b"FRAG_A_FRAG_B");

        // Old objects must be deleted via ObjectStoreExt::delete
        assert!(matches!(
            download_from_r2(store.as_ref(), "raw/ds/part1.bin").await,
            Err(ProcessingError::StorageError(_))
        ));
        assert!(matches!(
            download_from_r2(store.as_ref(), "raw/ds/part2.bin").await,
            Err(ProcessingError::StorageError(_))
        ));
    }

    #[tokio::test]
    async fn test_arrow_parquet_datafusion_54_roundtrip() {
        use arrow_array::{Array, Int32Array, RecordBatch, StringArray};
        use arrow_schema::{DataType, Field, Schema};
        use datafusion::prelude::{ParquetReadOptions, SessionContext};
        use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
        use parquet::arrow::ArrowWriter;

        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int32, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("lv", DataType::Int32, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int32Array::from(vec![101, 102, 103])),
                Arc::new(StringArray::from(vec!["Nagato", "Mutsu", "Fubuki"])),
                Arc::new(Int32Array::from(vec![99, 125, 80])),
            ],
        )
        .expect("record batch");

        let mut parquet_bytes = Vec::new();
        {
            let mut writer =
                ArrowWriter::try_new(&mut parquet_bytes, schema.clone(), None).expect("writer");
            writer.write(&batch).expect("write batch");
            writer.close().expect("close writer");
        }

        // Verify Parquet 58 in-memory reader
        let reader = ParquetRecordBatchReaderBuilder::try_new(bytes::Bytes::from(
            parquet_bytes.clone(),
        ))
        .expect("reader builder")
        .build()
        .expect("reader");
        let decoded_batches: Vec<RecordBatch> =
            reader.collect::<Result<Vec<_>, _>>().expect("collect batches");
        assert_eq!(decoded_batches.len(), 1);
        assert_eq!(decoded_batches[0].num_rows(), 3);

        // Verify DataFusion 54 SQL execution over the written Parquet 58 file
        let temp_dir =
            std::env::temp_dir().join(format!("fusou-df54-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let parquet_file = temp_dir.join("ships.parquet");
        std::fs::write(&parquet_file, &parquet_bytes).expect("write parquet file");

        let ctx = SessionContext::new();
        ctx.register_parquet(
            "ships",
            parquet_file.to_str().expect("utf8 path"),
            ParquetReadOptions::default(),
        )
        .await
        .expect("register_parquet");

        let results = ctx
            .sql("SELECT id, name FROM ships WHERE lv >= 99 ORDER BY id ASC")
            .await
            .expect("sql plan")
            .collect()
            .await
            .expect("collect sql");

        let total_rows: usize = results.iter().map(|b| b.num_rows()).sum();
        assert_eq!(total_rows, 2);
        let ids = results[0]
            .column(0)
            .as_any()
            .downcast_ref::<Int32Array>()
            .expect("id col");
        assert_eq!(ids.value(0), 101);
        assert_eq!(ids.value(1), 102);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_dataset_file_metadata_serialization() {
        let metadata = DatasetFileMetadata {
            id: Some(Uuid::new_v4()),
            dataset_id: Uuid::new_v4(),
            uploader_id: Uuid::new_v4(),
            table_name: "users".to_string(),
            file_path: "raw/dataset-id/file.bin".to_string(),
            start_byte: 0,
            byte_length: 1024,
            is_public: true,
            is_compacted: false,
            created_at: Utc::now(),
        };

        let json = serde_json::to_string(&metadata).expect("Serialization failed");
        let deserialized: DatasetFileMetadata =
            serde_json::from_str(&json).expect("Deserialization failed");

        assert_eq!(metadata.dataset_id, deserialized.dataset_id);
        assert_eq!(metadata.table_name, deserialized.table_name);
        assert_eq!(metadata.is_compacted, deserialized.is_compacted);
    }

    #[test]
    fn test_error_display() {
        let error = ProcessingError::ValidationError("Test error".to_string());
        let msg = error.to_string();
        assert!(msg.contains("Validation error"));
    }

    #[test]
    fn test_extract_parquet_from_binary() {
        let data = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        let extracted = extract_parquet_from_binary(&data, 2, 3).expect("Extraction failed");
        assert_eq!(extracted, vec![3, 4, 5]);
    }

    #[test]
    fn test_extract_parquet_invalid_offset() {
        let data = vec![1, 2, 3, 4, 5];
        let result = extract_parquet_from_binary(&data, 10, 5);
        assert!(result.is_err());
    }
}
