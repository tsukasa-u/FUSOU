use google_drive3::hyper_rustls;
use google_drive3::hyper_util;
use google_drive3::DriveHub;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use google_drive3::yup_oauth2::AccessTokenAuthenticator;

pub static USER_ACCESS_TOKEN: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
pub static SURVICE_ACCESS_TOKEN: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

pub async fn create_clinent() -> Option<
    DriveHub<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> {
    let access_token = USER_ACCESS_TOKEN.lock().unwrap().clone()?;

    let auth = AccessTokenAuthenticator::builder(access_token)
        .build()
        .await
        .expect("Failed to create authenticator");

    let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
        .build(
            hyper_rustls::HttpsConnectorBuilder::new()
                .with_native_roots()
                .unwrap()
                .https_or_http()
                .enable_http1()
                .build(),
        );
    let hub = DriveHub::new(client, auth);
    return Some(hub);
}

pub async fn get_drive_file_list(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
) -> Option<Vec<String>> {
    let result = hub.files().list().page_size(10).doit().await.ok()?;
    let files = result.1.files?;
    let mut file_list = Vec::<String>::new();

    for file in files {
        file_list.push(file.name.unwrap_or_default());
    }
    println!("Files: {:?}", file_list);
    return Some(file_list);
}
