// Common logic for generating file names

use chrono::{TimeZone, Utc};
use chrono_tz::Asia::Tokyo;
use uuid::Uuid;

use crate::storage::constants::{AVRO_FILE_EXTENSION, PORT_TABLE_FILE_NAME_SEPARATOR};

/// Generate a timestamped filename for port table data
/// Format: {timestamp}_{uuid}.avro
pub fn generate_port_table_filename() -> String {
    let utc = Utc::now().naive_utc();
    let jst = Tokyo.from_utc_datetime(&utc);
    format!(
        "{}{}{}{}",
        jst.timestamp(),
        PORT_TABLE_FILE_NAME_SEPARATOR,
        Uuid::new_v4(),
        AVRO_FILE_EXTENSION
    )
}

/// Generate a filename for a master data table
/// Format: {table_name}.avro
pub fn generate_master_data_filename(table_name: &str) -> String {
    format!("{}{}", table_name, AVRO_FILE_EXTENSION)
}
