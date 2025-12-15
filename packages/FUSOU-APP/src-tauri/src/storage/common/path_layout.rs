use std::path::{Path, PathBuf};

use crate::storage::constants::{
    MASTER_DATA_FOLDER_NAME,
    PERIOD_ROOT_FOLDER_NAME,
    TRANSACTION_DATA_FOLDER_NAME,
};

// String-based layout helpers (for cloud providers)

pub fn master_folder(period_tag: &str) -> String {
    format!(
        "{}/{}/{}",
        PERIOD_ROOT_FOLDER_NAME, period_tag, MASTER_DATA_FOLDER_NAME
    )
}

pub fn transaction_root(period_tag: &str) -> String {
    format!(
        "{}/{}/{}",
        PERIOD_ROOT_FOLDER_NAME, period_tag, TRANSACTION_DATA_FOLDER_NAME
    )
}

// PathBuf-based layout helpers (for local filesystem providers)

pub fn master_dir(root: &Path, period_tag: &str) -> PathBuf {
    root.join(PERIOD_ROOT_FOLDER_NAME).join(period_tag).join(MASTER_DATA_FOLDER_NAME)
}

pub fn transaction_root_dir(root: &Path, period_tag: &str) -> PathBuf {
    root.join(PERIOD_ROOT_FOLDER_NAME).join(period_tag).join(TRANSACTION_DATA_FOLDER_NAME)
}

pub fn map_dir(root: &Path, period_tag: &str, maparea_id: i64, mapinfo_no: i64) -> PathBuf {
    transaction_root_dir(root, period_tag).join(format!("{}-{}", maparea_id, mapinfo_no))
}

pub fn table_dir(root: &Path, period_tag: &str, maparea_id: i64, mapinfo_no: i64, table_name: &str) -> PathBuf {
    map_dir(root, period_tag, maparea_id, mapinfo_no).join(table_name)
}

pub fn parse_map_ids(map_folder_name: &str) -> Option<(i64, i64)> {
    let mut parts = map_folder_name.splitn(2, '-');
    let a = parts.next()?.trim().parse::<i64>().ok()?;
    let b = parts.next()?.trim().parse::<i64>().ok()?;
    Some((a, b))
}
