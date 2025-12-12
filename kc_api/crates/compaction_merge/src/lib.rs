use anyhow::Result;
use datafusion::arrow::record_batch::RecordBatch;
use datafusion::arrow::util::pretty::print_batches;
use datafusion::datasource::file_format::parquet::ParquetFormat;
use datafusion::datasource::listing::{ListingOptions, ListingTable, ListingTableConfig};
use datafusion::prelude::*;
use parquet::arrow::ArrowWriter;
use std::fs::File;
use std::sync::Arc;
use tracing::info;

/// Scaffold: merge multiple Parquet fragments into a unified dataset.
/// Assumes additive schema evolution; configurable merge rules to be added.
pub async fn merge_parquet_fragments(paths: Vec<String>, output_path: String) -> Result<()> {
    let ctx = SessionContext::new();
    // Use listing table to read multiple files with schema reconciliation (additive evolution assumed)
    let options = ListingOptions::new(Arc::new(ParquetFormat::default()))
        .with_collect_stat(true);
    let config = ListingTableConfig::new(Arc::new(ObjectStoreUrl::local_filesystem()))
        .with_listing_options(options)
        .with_paths(paths.iter().map(|p| p.into()).collect());
    let table = ListingTable::try_new(config)?;
    ctx.register_table("fragments", Arc::new(table))?;

    let df = ctx.table("fragments")?;
    let batches: Vec<RecordBatch> = df.collect().await?;
    let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();
    info!(total_rows, "merged batches collected");
    // Optional: debug
    // print_batches(&batches)?;

    // Write out to a single Parquet file
    let file = File::create(&output_path)?;
    let mut writer = ArrowWriter::try_new(file, batches[0].schema(), None)?;
    for b in batches {
        writer.write(&b)?;
    }
    writer.close()?;
    Ok(())
}
