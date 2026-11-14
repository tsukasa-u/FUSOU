#[allow(dead_code)]
pub(crate) const STORAGE_ROOT_DIR_NAME: &str = "FUSOU";
pub(crate) const STORAGE_SUB_DIR_NAME: &str = "FUSOU-DATABASE";
pub(crate) const PERIOD_ROOT_FOLDER_NAME: &str = "fusou";
pub(crate) const MASTER_DATA_FOLDER_NAME: &str = "master_data";
pub(crate) const TRANSACTION_DATA_FOLDER_NAME: &str = "transaction_data";
pub(crate) const QUEST_DATA_FOLDER_NAME: &str = "quest_data";
pub(crate) const QUEST_TREE_JSONL_FILE_NAME: &str = "quest_tree.jsonl";
pub(crate) const SHIP_GROWTH_DATA_FOLDER_NAME: &str = "ship_growth";
pub(crate) const SHIP_GROWTH_JSONL_FILE_NAME: &str = "snapshots.jsonl";
pub(crate) const SOKU_SPEED_DATA_FOLDER_NAME: &str = "soku_speed";
pub(crate) const SOKU_SPEED_JSONL_FILE_NAME: &str = "snapshots.jsonl";
pub(crate) const REMODEL_DATA_FOLDER_NAME: &str = "remodel_data";
pub(crate) const REMODEL_JSONL_FILE_NAME: &str = "remodel.jsonl";
pub(crate) const PORT_TABLE_FILE_NAME_SEPARATOR: &str = "_";
pub(crate) const AVRO_FILE_EXTENSION: &str = ".avro";
pub(crate) const LOCAL_STORAGE_PROVIDER_NAME: &str = "local";
#[cfg(feature = "gdrive")]
pub(crate) const GOOGLE_DRIVE_PROVIDER_NAME: &str = "google_drive";
#[cfg(feature = "gdrive")]
pub(crate) const GOOGLE_DRIVE_ROOT_FOLDER_ID: &str = "root";
#[cfg(feature = "gdrive")]
pub(crate) const GOOGLE_DRIVE_FOLDER_MIME_TYPE: &str = "application/vnd.google-apps.folder";
#[cfg(feature = "gdrive")]
pub(crate) const GOOGLE_DRIVE_TRASHED_FILTER: &str = "trashed = false";
