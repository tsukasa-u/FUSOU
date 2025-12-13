//! Batch Upload Module for Multiple Tables
//!
//! This module provides functionality to:
//! 1. Convert multiple Avro tables to Parquet format
//! 2. Concatenate them into a single binary file
//! 3. Track offset information for later extraction
//!
//! # Example
//! ```ignore
//! use kc_api_database::batch_upload::{BatchUploadBuilder, TableData};
//!
//! let mut builder = BatchUploadBuilder::new();
//! builder.add_table("api_port", avro_port_data);
//! builder.add_table("api_ship", avro_ship_data);
//!
//! let batch = builder.build()?;
//! // batch.data: concatenated binary
//! // batch.metadata: offset info for each table
//! ```

use crate::avro_to_parquet::{AvroToParquetConverter, ConversionError, ConversionResult};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

/// Metadata for a table within the concatenated file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableMetadata {
    /// Name of the table (e.g., "api_port", "api_ship")
    pub table_name: String,
    /// Starting byte position in the concatenated file
    pub start_byte: usize,
    /// Length of the table data in bytes
    pub byte_length: usize,
    /// Format of the data (always "parquet" for now)
    pub format: String,
}

/// Result of batch upload preparation
#[derive(Debug)]
pub struct BatchUploadData {
    /// Concatenated binary data (all tables)
    pub data: Vec<u8>,
    /// Metadata for each table
    pub metadata: Vec<TableMetadata>,
    /// Total size in bytes
    pub total_bytes: usize,
}

/// Individual table data before processing
#[derive(Debug, Clone)]
pub struct TableData {
    /// Table name
    pub name: String,
    /// Avro binary data
    pub avro_data: Vec<u8>,
}

/// Builder for creating batch uploads
///
/// This builder:
/// 1. Collects multiple tables in Avro format
/// 2. Converts each to Parquet
/// 3. Concatenates into a single file
/// 4. Generates offset metadata
pub struct BatchUploadBuilder {
    tables: Vec<TableData>,
    converter: AvroToParquetConverter,
}

impl Default for BatchUploadBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl BatchUploadBuilder {
    /// Create a new batch upload builder
    pub fn new() -> Self {
        Self {
            tables: Vec::new(),
            converter: AvroToParquetConverter::new(),
        }
    }

    /// Create builder with custom Parquet converter
    pub fn with_converter(mut self, converter: AvroToParquetConverter) -> Self {
        self.converter = converter;
        self
    }

    /// Add a table to the batch
    ///
    /// # Arguments
    /// * `table_name` - Name of the table (e.g., "api_port")
    /// * `avro_data` - Binary data in Avro format
    pub fn add_table(&mut self, table_name: impl Into<String>, avro_data: Vec<u8>) -> &mut Self {
        self.tables.push(TableData {
            name: table_name.into(),
            avro_data,
        });
        self
    }

    /// Add multiple tables at once
    pub fn add_tables(&mut self, tables: Vec<TableData>) -> &mut Self {
        self.tables.extend(tables);
        self
    }

    /// Build the batch upload data
    ///
    /// # Process
    /// 1. Convert each Avro table to Parquet
    /// 2. Concatenate all Parquet files
    /// 3. Generate metadata with offsets
    ///
    /// # Returns
    /// `BatchUploadData` containing concatenated data and metadata
    pub fn build(self) -> ConversionResult<BatchUploadData> {
        if self.tables.is_empty() {
            return Err(ConversionError::ValidationError(
                "No tables added to batch".to_string(),
            ));
        }

        info!("Starting batch upload build: {} tables", self.tables.len());

        // Step 1: Convert all tables to Parquet
        let mut parquet_tables = Vec::new();
        for table in &self.tables {
            debug!("Converting table '{}' to Parquet ({} bytes)", table.name, table.avro_data.len());
            
            // Use blocking conversion since avro_to_parquet is async
            let parquet_bytes = tokio::runtime::Runtime::new()
                .map_err(|e| ConversionError::IoError(e.to_string()))?
                .block_on(self.converter.convert(&table.avro_data))?;
            
            parquet_tables.push((table.name.clone(), parquet_bytes));
            debug!("Converted '{}': {} bytes Parquet", table.name, parquet_tables.last().unwrap().1.len());
        }

        // Step 2: Concatenate all Parquet files and track offsets
        let mut concatenated = Vec::new();
        let mut metadata = Vec::new();

        for (table_name, parquet_bytes) in parquet_tables {
            let start_byte = concatenated.len();
            let byte_length = parquet_bytes.len();

            concatenated.extend_from_slice(&parquet_bytes);

            metadata.push(TableMetadata {
                table_name: table_name.clone(),
                start_byte,
                byte_length,
                format: "parquet".to_string(),
            });

            debug!(
                "Added '{}' to batch: offset={}, length={}",
                table_name, start_byte, byte_length
            );
        }

        let total_bytes = concatenated.len();
        info!("Batch upload build completed: {} bytes total", total_bytes);

        Ok(BatchUploadData {
            data: concatenated,
            metadata,
            total_bytes,
        })
    }
}

/// Helper function to extract a specific table from concatenated data
///
/// # Arguments
/// * `data` - Concatenated binary data
/// * `metadata` - Table metadata with offset information
///
/// # Returns
/// Extracted Parquet binary for the specified table
pub fn extract_table(data: &[u8], metadata: &TableMetadata) -> ConversionResult<Vec<u8>> {
    let start = metadata.start_byte;
    let end = start + metadata.byte_length;

    if end > data.len() {
        return Err(ConversionError::ValidationError(format!(
            "Invalid offset for table '{}': start={}, length={}, data_size={}",
            metadata.table_name, start, metadata.byte_length, data.len()
        )));
    }

    Ok(data[start..end].to_vec())
}

/// Helper function to create metadata JSON for storage
pub fn metadata_to_json(metadata: &[TableMetadata]) -> Result<String, serde_json::Error> {
    serde_json::to_string(metadata)
}

/// Helper function to parse metadata from JSON
pub fn metadata_from_json(json: &str) -> Result<Vec<TableMetadata>, serde_json::Error> {
    serde_json::from_str(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_builder_empty() {
        let builder = BatchUploadBuilder::new();
        let result = builder.build();
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ConversionError::ValidationError(_)));
    }

    #[test]
    fn test_metadata_serialization() {
        let metadata = vec![
            TableMetadata {
                table_name: "api_port".to_string(),
                start_byte: 0,
                byte_length: 1024,
                format: "parquet".to_string(),
            },
            TableMetadata {
                table_name: "api_ship".to_string(),
                start_byte: 1024,
                byte_length: 2048,
                format: "parquet".to_string(),
            },
        ];

        let json = metadata_to_json(&metadata).unwrap();
        let deserialized = metadata_from_json(&json).unwrap();

        assert_eq!(metadata.len(), deserialized.len());
        assert_eq!(metadata[0].table_name, deserialized[0].table_name);
        assert_eq!(metadata[1].start_byte, deserialized[1].start_byte);
    }

    #[test]
    fn test_extract_table() {
        let data = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        let metadata = TableMetadata {
            table_name: "test_table".to_string(),
            start_byte: 2,
            byte_length: 5,
            format: "parquet".to_string(),
        };

        let extracted = extract_table(&data, &metadata).unwrap();
        assert_eq!(extracted, vec![3, 4, 5, 6, 7]);
    }

    #[test]
    fn test_extract_table_invalid_offset() {
        let data = vec![1, 2, 3, 4, 5];
        let metadata = TableMetadata {
            table_name: "test_table".to_string(),
            start_byte: 10,
            byte_length: 5,
            format: "parquet".to_string(),
        };

        let result = extract_table(&data, &metadata);
        assert!(result.is_err());
    }
}
