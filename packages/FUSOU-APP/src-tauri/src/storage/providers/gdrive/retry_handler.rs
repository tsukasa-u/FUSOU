// Google Drive specific retry handler

use serde::{Deserialize, Serialize};
use fusou_upload::retry_service::RetryHandler;
use std::pin::Pin;
use std::future::Future;
use super::{create_file_raw, create_or_replace_file_raw, delete_file_raw, create_client};

#[derive(Serialize, Deserialize, Debug)]
pub enum GoogleDriveOperation {
    CreateFile {
        file_name: String,
        mime_type: String,
        folder_id: Option<String>,
    },
    CreateOrReplaceFile {
        file_name: String,
        mime_type: String,
        folder_id: Option<String>,
    },
    DeleteFile {
        file_id: String,
    }
}

pub struct GoogleDriveRetryHandler;

impl RetryHandler for GoogleDriveRetryHandler {
    fn handle<'a>(&'a self, context: &'a serde_json::Value, data: &'a [u8]) -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + 'a>> {
        Box::pin(async move {
            let operation: GoogleDriveOperation = serde_json::from_value(context.clone())?;
            
            let mut hub = match create_client().await {
                Some(hub) => hub,
                None => return Err("Failed to create Google Drive client".into()),
            };

            match operation {
                GoogleDriveOperation::CreateFile { file_name, mime_type, folder_id } => {
                    create_file_raw(&mut hub, file_name, mime_type, data, folder_id).await?;
                },
                GoogleDriveOperation::CreateOrReplaceFile { file_name, mime_type, folder_id } => {
                    create_or_replace_file_raw(&mut hub, file_name, mime_type, data, folder_id).await?;
                },
                GoogleDriveOperation::DeleteFile { file_id } => {
                    delete_file_raw(&mut hub, file_id).await?;
                }
            }
            Ok(())
        })
    }
}
