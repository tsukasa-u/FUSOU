# Avro to Parquet Conversion

This module provides utilities to convert Apache Avro data to Apache Parquet format using DataFusion.

## Overview

The `avro_to_parquet` module in `kc-api-database` provides:
- Conversion from Avro binary format to Parquet columnar format
- SNAPPY compression by default
- Automatic schema inference from Avro
- Memory-efficient batch processing

## Usage

### Basic Conversion

```rust
use kc_api_database::avro_to_parquet::AvroToParquetConverter;

// Read Avro data (e.g., from API response)
let avro_data: Vec<u8> = get_avro_data_from_api();

// Create converter with default settings
let converter = AvroToParquetConverter::new();

// Convert to Parquet
let parquet_bytes = converter.convert(&avro_data).await?;

// Now parquet_bytes can be uploaded to R2 storage
```

### Custom Compression

```rust
use kc_api_database::avro_to_parquet::AvroToParquetConverter;
use parquet::basic::Compression;

let converter = AvroToParquetConverter::new()
    .with_compression(Compression::ZSTD(Default::default()))
    .with_batch_size(16384);

let parquet_bytes = converter.convert(&avro_data).await?;
```

### Integration with FUSOU-APP

```rust
// In FUSOU-APP/src-tauri
use kc_api_database::avro_to_parquet::AvroToParquetConverter;

async fn upload_game_data(api_response: Vec<u8>) -> Result<(), Box<dyn Error>> {
    // Convert Avro response to Parquet
    let converter = AvroToParquetConverter::new();
    let parquet_data = converter.convert(&api_response).await?;
    
    // Upload to R2 using fusou-upload or direct upload
    let metadata = upload_to_r2(parquet_data).await?;
    
    Ok(())
}
```

## Architecture

```
Game API Response (JSON/Binary)
    ↓
kc-api (Parse & Validate)
    ↓
kc-api-database (Serialize to Avro)
    ↓
avro_to_parquet (Convert to Parquet) ← This module
    ↓
fusou-upload (Upload to R2)
    ↓
R2 Storage (Optimized columnar storage)
```

## Error Handling

The converter returns `ConversionResult<T>` with detailed error types:

```rust
use kc_api_database::avro_to_parquet::{AvroToParquetConverter, ConversionError};

match converter.convert(&avro_data).await {
    Ok(parquet) => println!("Converted {} bytes", parquet.len()),
    Err(ConversionError::AvroError(msg)) => eprintln!("Avro error: {}", msg),
    Err(ConversionError::ParquetError(msg)) => eprintln!("Parquet error: {}", msg),
    Err(ConversionError::SchemaError(msg)) => eprintln!("Schema error: {}", msg),
    Err(e) => eprintln!("Other error: {}", e),
}
```

## Performance

- **Batch Processing**: Processes records in configurable batches (default: 8192 records)
- **Compression**: SNAPPY compression reduces file size by ~50-70%
- **Memory Efficient**: Streaming conversion avoids loading entire dataset in memory

## Future Enhancements

- [ ] Advanced type mapping for complex Avro schemas
- [ ] Support for nested record structures
- [ ] Custom writer properties (row group size, statistics, etc.)
- [ ] Parallel batch processing
- [ ] Integration with DataFusion for query optimization
