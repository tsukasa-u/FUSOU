// Google Drive API operations (raw functions with retry logic)

use super::client::DriveClient;
use crate::storage::constants::{
    GOOGLE_DRIVE_FOLDER_MIME_TYPE, GOOGLE_DRIVE_TRASHED_FILTER,
};
use http_body_util::BodyExt;
use tokio::time::sleep;

pub fn backoff_delay(attempt: u32) -> tokio::time::Duration {
    // 200ms, 500ms, 1s, 2s, 4s (cap)
    let millis = match attempt {
        0 => 200,
        1 => 500,
        2 => 1000,
        3 => 2000,
        _ => 4000,
    };
    tokio::time::Duration::from_millis(millis)
}

// Raw implementations without error handling wrapper

pub async fn get_file_content(
    hub: &mut DriveClient,
    file_id: String,
) -> Option<Vec<u8>> {
    let mut last_err: Option<String> = None;
    for attempt in 0..5u32 {
        let result = hub.files().get(&file_id).param("alt", "media").doit().await;
        match result {
            Ok(result) => {
                let bytes = result.0.into_body().collect().await.ok()?.to_bytes();
                return Some(bytes.to_vec());
            }
            Err(e) => {
                let msg = format!("{e:?}");
                last_err = Some(msg.clone());
                tracing::warn!(
                    "google drive get_file_content failed (attempt {}): {}",
                    attempt + 1,
                    msg
                );
                if attempt < 4 {
                    sleep(backoff_delay(attempt)).await;
                    continue;
                } else {
                    break;
                }
            }
        }
    }
    tracing::error!(
        "get_file_content giving up after retries: {}",
        last_err.unwrap_or_else(|| "unknown error".to_string())
    );
    None
}

pub async fn get_file_list_in_folder(
    hub: &mut DriveClient,
    parent_folder_id: Option<String>,
    page_size: i32,
    mime_type: String,
) -> Option<Vec<String>> {
    let query = match parent_folder_id {
        Some(parent_folder_id) => format!(
            "mimeType='{mime_type}' and {trash_filter} and '{parent_folder_id}' in parents",
            trash_filter = GOOGLE_DRIVE_TRASHED_FILTER
        ),
        None => format!(
            "mimeType='{mime_type}' and {trash_filter}",
            trash_filter = GOOGLE_DRIVE_TRASHED_FILTER
        ),
    };
    let mut last_err: Option<String> = None;
    for attempt in 0..5u32 {
        let result = hub
            .files()
            .list()
            .q(&query)
            .param("fields", "files(id),nextPageToken")
            .page_size(page_size.min(100))
            .doit()
            .await;
        match result {
            Ok(result) => {
                let files = result.1.files?;
                let mut file_list = Vec::<String>::new();
                for file in files {
                    file_list.push(file.id.unwrap_or_default());
                }
                return Some(file_list);
            }
            Err(e) => {
                let msg = format!("{e:?}");
                last_err = Some(msg.clone());
                tracing::warn!(
                    "google drive list failed (attempt {}): {}",
                    attempt + 1,
                    msg
                );
                if attempt < 4 {
                    sleep(backoff_delay(attempt)).await;
                    continue;
                } else {
                    break;
                }
            }
        }
    }
    tracing::error!(
        "get_file_list_in_folder giving up after retries: {}",
        last_err.unwrap_or_else(|| "unknown error".to_string())
    );
    None
}

pub async fn check_folder(
    hub: &mut DriveClient,
    folder_name: String,
    parent_folder_id: Option<String>,
) -> Option<String> {
    let query  = match parent_folder_id {
        Some(parent_folder_id) => format!(
            "mimeType='{folder_mime}' and name='{folder_name}' and {trash_filter} and '{parent_folder_id}' in parents",
            folder_mime = GOOGLE_DRIVE_FOLDER_MIME_TYPE,
            trash_filter = GOOGLE_DRIVE_TRASHED_FILTER
        ),
        None => format!(
            "mimeType='{folder_mime}' and name='{folder_name}' and {trash_filter}",
            folder_mime = GOOGLE_DRIVE_FOLDER_MIME_TYPE,
            trash_filter = GOOGLE_DRIVE_TRASHED_FILTER
        ),
    };
    let mut last_err: Option<String> = None;
    for attempt in 0..5u32 {
        let result = hub
            .files()
            .list()
            .q(&query)
            .param("fields", "files(id)")
            .page_size(10)
            .doit()
            .await;
        match result {
            Ok(result) => {
                let files = result.1.files?;
                if files.is_empty() {
                    return None;
                }
                return Some(files[0].id.clone().unwrap());
            }
            Err(e) => {
                let msg = format!("{e:?}");
                last_err = Some(msg.clone());
                tracing::warn!(
                    "google drive check_folder failed (attempt {}): {}",
                    attempt + 1,
                    msg
                );
                if attempt < 4 {
                    sleep(backoff_delay(attempt)).await;
                    continue;
                } else {
                    break;
                }
            }
        }
    }
    tracing::error!(
        "check_folder giving up after retries: {}",
        last_err.unwrap_or_else(|| "unknown error".to_string())
    );
    None
}

pub async fn check_file(
    hub: &mut DriveClient,
    file_name: String,
    mime_type: String,
    parent_folder_id: Option<String>,
) -> Option<String> {
    let query = match parent_folder_id {
        Some(parent_folder_id) => format!(
            "mimeType='{mime_type}' and name='{file_name}' and {trash_filter} and '{parent_folder_id}' in parents",
            trash_filter = GOOGLE_DRIVE_TRASHED_FILTER
        ),
        None => format!(
            "mimeType='{mime_type}' and name='{file_name}' and {trash_filter}",
            trash_filter = GOOGLE_DRIVE_TRASHED_FILTER
        ),
    };
    let mut last_err: Option<String> = None;
    for attempt in 0..5u32 {
        let result = hub
            .files()
            .list()
            .q(&query)
            .param("fields", "files(id)")
            .page_size(10)
            .doit()
            .await;
        match result {
            Ok(result) => {
                let files = result.1.files?;
                if files.is_empty() {
                    return None;
                }
                return Some(files[0].id.clone().unwrap());
            }
            Err(e) => {
                let msg = format!("{e:?}");
                last_err = Some(msg.clone());
                tracing::warn!(
                    "google drive check_file failed (attempt {}): {}",
                    attempt + 1,
                    msg
                );
                if attempt < 4 {
                    sleep(backoff_delay(attempt)).await;
                    continue;
                } else {
                    break;
                }
            }
        }
    }
    tracing::error!(
        "check_file giving up after retries: {}",
        last_err.unwrap_or_else(|| "unknown error".to_string())
    );
    None
}

pub async fn create_file_raw(
    hub: &mut DriveClient,
    file_name: String,
    mime_type: String,
    content: &[u8],
    folder_id: Option<String>,
) -> Result<String, google_drive3::Error> {
    let result = check_file(hub, file_name.clone(), mime_type.clone(), folder_id.clone()).await;
    if let Some(id) = result {
        return Ok(id);
    }

    let parent_folder_ids = folder_id.map(|id| vec![id]);

    let req = google_drive3::api::File {
        name: Some(file_name),
        mime_type: Some(mime_type.clone()),
        parents: parent_folder_ids,
        ..Default::default()
    };

    let mut last_err: google_drive3::Error = google_drive3::Error::MissingAPIKey; // Dummy init
    for attempt in 0..5u32 {
        let create_result = hub
            .files()
            .create(req.clone())
            .upload(std::io::Cursor::new(content), mime_type.parse().unwrap())
            .await;
        match create_result {
            Ok(result) => return Ok(result.1.id.unwrap_or_default()),
            Err(e) => {
                last_err = e;
                let msg = format!("{last_err:?}");
                tracing::warn!(
                    "google drive create upload failed (attempt {}): {}",
                    attempt + 1,
                    msg
                );
                
                // If 401/403, return immediately to let wrapper handle it
                if let google_drive3::Error::Failure(resp) = &last_err {
                    let status = resp.status();
                    if status == 401 || status == 403 {
                        return Err(last_err);
                    }
                }

                if attempt < 4 {
                    sleep(backoff_delay(attempt)).await;
                    continue;
                }
            }
        }
    }
    Err(last_err)
}

pub async fn create_or_replace_file_raw(
    hub: &mut DriveClient,
    file_name: String,
    mime_type: String,
    content: &[u8],
    folder_id: Option<String>,
) -> Result<String, google_drive3::Error> {
    if let Some(existing_id) =
        check_file(hub, file_name.clone(), mime_type.clone(), folder_id.clone()).await
    {
        let req = google_drive3::api::File {
            name: Some(file_name.clone()),
            mime_type: Some(mime_type.clone()),
            parents: None,
            ..Default::default()
        };
        let mut last_err: google_drive3::Error = google_drive3::Error::MissingAPIKey;
        for attempt in 0..5u32 {
            let update_result = hub
                .files()
                .update(req.clone(), &existing_id)
                .upload(std::io::Cursor::new(content), mime_type.parse().unwrap())
                .await;
            match update_result {
                Ok(_) => return Ok(existing_id),
                Err(err) => {
                    last_err = err;
                    let msg = format!("{last_err:?}");
                    tracing::warn!(
                        "google drive update upload failed (attempt {}): {}",
                        attempt + 1,
                        msg
                    );

                    if let google_drive3::Error::Failure(resp) = &last_err {
                        let status = resp.status();
                        if status == 401 || status == 403 {
                            return Err(last_err);
                        }
                    }

                    if attempt < 4 {
                        sleep(backoff_delay(attempt)).await;
                        continue;
                    }
                }
            }
        }
        return Err(last_err);
    }

    create_file_raw(hub, file_name, mime_type, content, folder_id).await
}

pub async fn delete_file_raw(
    hub: &mut DriveClient,
    file_id: String,
) -> Result<(), google_drive3::Error> {
    let mut last_err: google_drive3::Error = google_drive3::Error::MissingAPIKey;
    for attempt in 0..5u32 {
        let result = hub.files().delete(&file_id).doit().await;
        match result {
            Ok(_) => return Ok(()),
            Err(e) => {
                last_err = e;
                let msg = format!("{last_err:?}");
                tracing::warn!(
                    "google drive delete_file failed (attempt {}): {}",
                    attempt + 1,
                    msg
                );
                
                if let google_drive3::Error::Failure(resp) = &last_err {
                    let status = resp.status();
                    if status == 401 || status == 403 {
                        return Err(last_err);
                    }
                }

                if attempt < 4 {
                    sleep(backoff_delay(attempt)).await;
                    continue;
                }
            }
        }
    }
    Err(last_err)
}

pub async fn check_or_create_folder(
    hub: &mut DriveClient,
    folder_name: String,
    parent_folder_id: Option<String>,
) -> Option<String> {
    let mime_type = GOOGLE_DRIVE_FOLDER_MIME_TYPE.to_string();

    let result = check_folder(hub, folder_name.clone(), parent_folder_id.clone()).await;
    if result.is_some() {
        return result;
    }

    let content = b"";

    // Use raw create but ignore errors (return None)
    match create_file_raw(hub, folder_name, mime_type, content, parent_folder_id).await {
        Ok(id) => Some(id),
        Err(_) => None,
    }
}

pub async fn check_or_create_folders(
    hub: &mut DriveClient,
    folder_names: Vec<String>,
    parent_folder_id: Option<String>,
) -> Option<Vec<String>> {
    let mut folder_ids = Vec::<String>::new();
    for folder_name in folder_names {
        let folder_id = check_or_create_folder(hub, folder_name, parent_folder_id.clone()).await;
        if let Some(folder_id) = folder_id {
            folder_ids.push(folder_id);
        } else {
            return None;
        }
    }
    return Some(folder_ids);
}

pub async fn check_or_create_folder_hierarchical(
    hub: &mut DriveClient,
    folder_names: Vec<String>,
    parent_folder_id: Option<String>,
) -> Option<String> {
    let mut folder_id = parent_folder_id;
    for folder_name in folder_names {
        let new_folder_id = check_or_create_folder(hub, folder_name, folder_id.clone()).await?;
        folder_id = Some(new_folder_id);
    }
    return folder_id;
}

// End of public API functions
