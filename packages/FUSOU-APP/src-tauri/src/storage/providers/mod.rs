// Storage providers module

pub mod gdrive;
pub mod local_fs;
pub mod r2;
pub mod cloud_table_provider;

pub use gdrive::cloud_storage_provider::GoogleDriveCloudStorageProvider;
pub use local_fs::LocalFileSystemProvider;
pub use r2::R2StorageProvider;
pub use cloud_table_provider::CloudTableStorageProvider;
