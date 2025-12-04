// Storage providers module

pub mod gdrive;
pub mod local_fs;

pub use gdrive::GoogleDriveProvider;
pub use local_fs::LocalFileSystemProvider;
