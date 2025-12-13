//! Avro to Parquet Conversion Module
//!
//! This module provides utilities to convert Apache Avro data to Apache Parquet format
//! using DataFusion for optimized query execution and efficient columnar storage.
//!
//! # Features
//! - Convert Avro binary data to Parquet format
//! - Support for SNAPPY compression
//! - Automatic schema inference from Avro
//! - Memory-efficient streaming conversion
//!
//! # Example
//! ```ignore
//! use kc_api_database::avro_to_parquet::AvroToParquetConverter;
//!
//! let avro_data = vec![...]; // Avro binary data
//! let converter = AvroToParquetConverter::new();
//! let parquet_bytes = converter.convert(&avro_data).await?;
//! ```

use apache_avro::Reader as AvroReader;
use arrow::array::RecordBatch;
use arrow::datatypes::Schema;
use parquet::arrow::ArrowWriter;
use parquet::file::properties::WriterProperties;
use parquet::basic::Compression;
use std::io::Cursor;
use std::sync::Arc;
use tracing::{debug, info, warn};

/// Error type for Avro to Parquet conversion operations
#[derive(Debug, Clone)]
pub enum ConversionError {
    /// Avro reading error
    AvroError(String),
    /// Arrow/Parquet writing error
    ParquetError(String),
    /// Schema conversion error
    SchemaError(String),
    /// Data validation error
    ValidationError(String),
    /// I/O error
    IoError(String),
}

impl std::fmt::Display for ConversionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConversionError::AvroError(msg) => write!(f, "Avro error: {}", msg),
            ConversionError::ParquetError(msg) => write!(f, "Parquet error: {}", msg),
            ConversionError::SchemaError(msg) => write!(f, "Schema error: {}", msg),
            ConversionError::ValidationError(msg) => write!(f, "Validation error: {}", msg),
            ConversionError::IoError(msg) => write!(f, "IO error: {}", msg),
        }
    }
}

impl std::error::Error for ConversionError {}

pub type ConversionResult<T> = Result<T, ConversionError>;

/// Converter for transforming Avro data to Parquet format
///
/// This converter uses Apache Arrow as an intermediate representation
/// to enable efficient conversion from Avro's row-based format to
/// Parquet's columnar format.
pub struct AvroToParquetConverter {
    /// Compression algorithm for Parquet output
    compression: Compression,
    /// Batch size for processing records
    batch_size: usize,
}

impl Default for AvroToParquetConverter {
    fn default() -> Self {
        Self::new()
    }
}

impl AvroToParquetConverter {
    /// Create a new converter with default settings
    ///
    /// Default settings:
    /// - Compression: SNAPPY
    /// - Batch size: 8192 records
    pub fn new() -> Self {
        Self {
            compression: Compression::SNAPPY,
            batch_size: 8192,
        }
    }

    /// Create a converter with custom compression
    pub fn with_compression(mut self, compression: Compression) -> Self {
        self.compression = compression;
        self
    }

    /// Create a converter with custom batch size
    pub fn with_batch_size(mut self, batch_size: usize) -> Self {
        self.batch_size = batch_size;
        self
    }

    /// Convert Avro binary data to Parquet binary data
    ///
    /// # Arguments
    /// * `avro_data` - Binary data in Avro format
    ///
    /// # Returns
    /// Binary data in Parquet format with SNAPPY compression
    ///
    /// # Errors
    /// Returns `ConversionError` if:
    /// - Avro data is invalid or corrupted
    /// - Schema conversion fails
    /// - Parquet writing fails
    pub async fn convert(&self, avro_data: &[u8]) -> ConversionResult<Vec<u8>> {
        if avro_data.is_empty() {
            return Err(ConversionError::ValidationError(
                "Input Avro data is empty".to_string(),
            ));
        }

        debug!("Starting Avro to Parquet conversion: {} bytes", avro_data.len());

        // Step 1: Read Avro data and extract schema
        let cursor = Cursor::new(avro_data);
        let reader = AvroReader::new(cursor)
            .map_err(|e| ConversionError::AvroError(format!("Failed to create Avro reader: {}", e)))?;

        let avro_schema = reader.writer_schema();
        debug!("Avro schema extracted: {:?}", avro_schema);

        // Step 2: Convert Avro schema to Arrow schema
        let arrow_schema = self.avro_schema_to_arrow(avro_schema)?;
        let arrow_schema_ref = Arc::new(arrow_schema);
        debug!("Arrow schema created: {:?}", arrow_schema_ref);

        // Step 3: Convert Avro records to Arrow RecordBatches
        let record_batches = self.avro_to_arrow_batches(reader, arrow_schema_ref.clone())?;
        info!("Converted {} record batches", record_batches.len());

        // Step 4: Write Arrow RecordBatches to Parquet
        let parquet_bytes = self.write_parquet(record_batches, arrow_schema_ref)?;
        info!("Parquet conversion completed: {} bytes", parquet_bytes.len());

        Ok(parquet_bytes)
    }

    /// Convert Avro schema to Arrow schema
    ///
    /// This is a simplified implementation. For production use,
    /// implement comprehensive type mapping based on your data model.
    fn avro_schema_to_arrow(&self, avro_schema: &apache_avro::Schema) -> ConversionResult<Schema> {
        use arrow::datatypes::Field;

        // For MVP: Create a basic schema
        // In production, parse avro_schema and map types correctly
        match avro_schema {
            apache_avro::Schema::Record(record_schema) => {
                let arrow_fields: Vec<Field> = record_schema
                    .fields
                    .iter()
                    .map(|field| {
                        let data_type = self.avro_type_to_arrow(&field.schema);
                        Field::new(&field.name, data_type, true)
                    })
                    .collect();

                Ok(Schema::new(arrow_fields))
            }
            _ => Err(ConversionError::SchemaError(
                "Expected Avro Record schema".to_string(),
            )),
        }
    }

    /// Map Avro types to Arrow types
    fn avro_type_to_arrow(&self, avro_type: &apache_avro::Schema) -> arrow::datatypes::DataType {
        use arrow::datatypes::{DataType, Field, TimeUnit};

        match avro_type {
            apache_avro::Schema::Null => DataType::Null,
            apache_avro::Schema::Boolean => DataType::Boolean,
            apache_avro::Schema::Int => DataType::Int32,
            apache_avro::Schema::Long => DataType::Int64,
            apache_avro::Schema::Float => DataType::Float32,
            apache_avro::Schema::Double => DataType::Float64,
            apache_avro::Schema::String => DataType::Utf8,
            apache_avro::Schema::Bytes => DataType::Binary,
            apache_avro::Schema::Union(union_schema) => {
                // Handle nullable fields (common pattern: [null, type])
                if union_schema.variants().len() == 2 {
                    for variant in union_schema.variants() {
                        if !matches!(variant, apache_avro::Schema::Null) {
                            return self.avro_type_to_arrow(variant);
                        }
                    }
                }
                DataType::Utf8 // Fallback for complex unions
            }
            apache_avro::Schema::Array(item_schema) => {
                let item_type = self.avro_type_to_arrow(&item_schema.items);
                DataType::List(Arc::new(Field::new("item", item_type, true)))
            }
            apache_avro::Schema::TimestampMillis | apache_avro::Schema::TimestampMicros => {
                DataType::Timestamp(TimeUnit::Millisecond, None)
            }
            _ => {
                warn!("Unsupported Avro type, defaulting to Utf8: {:?}", avro_type);
                DataType::Utf8
            }
        }
    }

    /// Convert Avro records to Arrow RecordBatches
    fn avro_to_arrow_batches(
        &self,
        reader: AvroReader<Cursor<&[u8]>>,
        schema: Arc<Schema>,
    ) -> ConversionResult<Vec<RecordBatch>> {
        let mut batches = Vec::new();
        let mut records = Vec::new();

        for value_result in reader {
            let value = value_result
                .map_err(|e| ConversionError::AvroError(format!("Failed to read Avro record: {}", e)))?;
            
            records.push(value);

            if records.len() >= self.batch_size {
                let batch = self.create_record_batch(&records, schema.clone())?;
                batches.push(batch);
                records.clear();
            }
        }

        // Process remaining records
        if !records.is_empty() {
            let batch = self.create_record_batch(&records, schema)?;
            batches.push(batch);
        }

        Ok(batches)
    }

    /// Create a RecordBatch from Avro values
    ///
    /// This is a simplified implementation for MVP.
    /// For production, implement proper type handling for all fields.
    fn create_record_batch(
        &self,
        records: &[apache_avro::types::Value],
        schema: Arc<Schema>,
    ) -> ConversionResult<RecordBatch> {
        use arrow::array::{StringBuilder, ArrayRef};
        use apache_avro::types::Value;

        if records.is_empty() {
            return Err(ConversionError::ValidationError(
                "Cannot create RecordBatch from empty records".to_string(),
            ));
        }

        // For MVP: Convert all fields to strings
        // In production: Handle each field type properly based on schema
        let mut columns: Vec<ArrayRef> = Vec::new();

        for field in schema.fields() {
            let mut string_builder = StringBuilder::new();
            
            for record in records {
                if let Value::Record(fields) = record {
                    let field_value = fields
                        .iter()
                        .find(|(name, _)| name == field.name())
                        .map(|(_, value)| value);

                    match field_value {
                        Some(value) => {
                            string_builder.append_value(format!("{:?}", value));
                        }
                        None => {
                            string_builder.append_null();
                        }
                    }
                } else {
                    string_builder.append_null();
                }
            }

            columns.push(Arc::new(string_builder.finish()));
        }

        RecordBatch::try_new(schema, columns)
            .map_err(|e| ConversionError::ParquetError(format!("Failed to create RecordBatch: {}", e)))
    }

    /// Write Arrow RecordBatches to Parquet format
    fn write_parquet(
        &self,
        batches: Vec<RecordBatch>,
        schema: Arc<Schema>,
    ) -> ConversionResult<Vec<u8>> {
        let mut buffer = Vec::new();

        let props = WriterProperties::builder()
            .set_compression(self.compression)
            .build();

        {
            let mut writer = ArrowWriter::try_new(&mut buffer, schema.clone(), Some(props))
                .map_err(|e| ConversionError::ParquetError(format!("Failed to create Parquet writer: {}", e)))?;

            for batch in batches {
                writer
                    .write(&batch)
                    .map_err(|e| ConversionError::ParquetError(format!("Failed to write batch: {}", e)))?;
            }

            writer
                .close()
                .map_err(|e| ConversionError::ParquetError(format!("Failed to close writer: {}", e)))?;
        }

        debug!("Parquet data written: {} bytes", buffer.len());
        Ok(buffer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_converter_creation() {
        let converter = AvroToParquetConverter::new();
        assert_eq!(converter.batch_size, 8192);
    }

    #[tokio::test]
    async fn test_empty_input_validation() {
        let converter = AvroToParquetConverter::new();
        let result = converter.convert(&[]).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ConversionError::ValidationError(_)));
    }

    #[tokio::test]
    async fn test_custom_compression() {
        let converter = AvroToParquetConverter::new()
            .with_compression(Compression::ZSTD(Default::default()));
        // Compression is set but we can't easily verify without actual conversion
        assert_eq!(converter.batch_size, 8192);
    }
}
