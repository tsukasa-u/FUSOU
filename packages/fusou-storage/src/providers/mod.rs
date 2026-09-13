// Storage providers module

pub mod cloud_table_provider;
#[cfg(feature = "gdrive")]
pub mod gdrive;
pub mod local_fs;
pub mod r2;

pub use cloud_table_provider::CloudTableStorageProvider;
#[cfg(feature = "gdrive")]
pub use gdrive::cloud_storage_provider::GoogleDriveCloudStorageProvider;
pub use local_fs::LocalFileSystemProvider;
pub use r2::R2StorageProvider;
