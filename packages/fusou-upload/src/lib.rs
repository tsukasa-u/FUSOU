pub mod pending_store;
pub mod retry_service;
pub mod uploader;
pub mod dataset_processor;
pub mod request_suppression_cache;

pub use pending_store::{PendingSaveOutcome, PendingStore};
pub use retry_service::UploadRetryService;
pub use uploader::{
    Uploader, UploadContext, UploadError, UploadRequest, UploadResult,
};
pub fn set_default_attestation_report_builder(builder: Option<fn(&str) -> serde_json::Value>) {
    Uploader::set_default_attestation_report_builder(builder);
}
pub use request_suppression_cache::{
    LocalRequestSuppressionCache,
    SuppressionCacheEntryStatus,
    SuppressionCacheStatus,
};
pub use dataset_processor::{
    DatasetFileMetadata, ProcessingError, ProcessingResult,
    process_and_upload_batch, compact_dataset_files,
};
