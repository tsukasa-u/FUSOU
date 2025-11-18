use chrono::{TimeZone, Utc};
use chrono_tz::Asia::Tokyo;
use google_drive3::{
    hyper_rustls, hyper_util, yup_oauth2, yup_oauth2::authenticator::Authenticator, DriveHub,
};
use http_body_util::BodyExt;
use once_cell::sync::Lazy;
use proxy_https::proxy_server_https::setup_default_crypto_provider;
use std::{collections::HashMap, sync::Mutex};
use tokio::sync::OnceCell;
use uuid::Uuid;

use kc_api::database::models::airbase::{AirBase, PlaneInfo};
use kc_api::database::models::battle::{
    AirBaseAirAttack, AirBaseAirAttackList, AirBaseAssult, Battle, CarrierBaseAssault,
    ClosingRaigeki, FriendlySupportHourai, FriendlySupportHouraiList, Hougeki, HougekiList,
    MidnightHougeki, MidnightHougekiList, OpeningAirAttack, OpeningAirAttackList, OpeningRaigeki,
    OpeningTaisen, OpeningTaisenList, SupportAirattack, SupportHourai,
};
use kc_api::database::models::cell::Cells;
use kc_api::database::models::deck::{EnemyDeck, FriendDeck, OwnDeck, SupportDeck};
use kc_api::database::models::ship::{EnemyShip, FriendShip, OwnShip};
use kc_api::database::models::slotitem::{EnemySlotItem, FriendSlotItem, OwnSlotItem};
use kc_api::database::table::{
    GetDataTableEnum, PortTableEnum, GET_DATA_TABLE_NAMES, PORT_TABLE_NAMES,
};
use kc_api::database::{integrate::integrate, models::env_info::EnvInfo};

use super::constants::{
    AVRO_FILE_EXTENSION, GOOGLE_DRIVE_AVRO_MIME_TYPE, GOOGLE_DRIVE_FOLDER_MIME_TYPE,
    GOOGLE_DRIVE_PROVIDER_NAME, GOOGLE_DRIVE_ROOT_FOLDER_ID, GOOGLE_DRIVE_TRASHED_FILTER,
    MASTER_DATA_FOLDER_NAME, PERIOD_ROOT_FOLDER_NAME, PORT_TABLE_FILE_NAME_SEPARATOR,
    TRANSACTION_DATA_FOLDER_NAME,
};
use super::service::{StorageError, StorageFuture, StorageProvider};
use crate::auth::auth_server;

type DriveClient =
    DriveHub<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>;

#[derive(Debug, Default, Clone)]
pub struct GoogleDriveProvider;

impl GoogleDriveProvider {
    async fn build_client(&self) -> Result<DriveClient, StorageError> {
        match create_client().await {
            Some(hub) => Ok(hub),
            None => {
                let _ = auth_server::open_auth_page();
                Err(StorageError::ClientUnavailable)
            }
        }
    }

    async fn ensure_period_folder(
        &self,
        hub: &mut DriveClient,
        period_tag: &str,
    ) -> Result<String, StorageError> {
        let folder_name = vec![PERIOD_ROOT_FOLDER_NAME.to_string(), period_tag.to_string()];
        check_or_create_folder_hierarchical(
            hub,
            folder_name,
            Some(GOOGLE_DRIVE_ROOT_FOLDER_ID.to_string()),
        )
        .await
        .ok_or_else(|| StorageError::Operation("failed to prepare google drive folder".into()))
    }
}

impl StorageProvider for GoogleDriveProvider {
    fn name(&self) -> &'static str {
        GOOGLE_DRIVE_PROVIDER_NAME
    }

    fn write_get_data_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a crate::database::table::GetDataTableEncode,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let mut hub = self.build_client().await?;
            let folder_id = self.ensure_period_folder(&mut hub, period_tag).await?;
            write_get_data_table(&mut hub, Some(folder_id), table.clone())
                .await
                .ok_or_else(|| StorageError::Operation("failed to write get data table".into()))?;
            Ok(())
        })
    }

    fn write_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a crate::database::table::PortTableEncode,
        maparea_id: i64,
        mapinfo_no: i64,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let mut hub = self.build_client().await?;
            let folder_id = self.ensure_period_folder(&mut hub, period_tag).await?;
            write_port_table(&mut hub, Some(folder_id), table.clone(), maparea_id, mapinfo_no)
                .await
                .ok_or_else(|| StorageError::Operation("failed to write port table".into()))?;
            Ok(())
        })
    }

    fn integrate_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        page_size: i32,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let mut hub = self.build_client().await?;
            let folder_id = self.ensure_period_folder(&mut hub, period_tag).await?;
            integrate_port_table(&mut hub, Some(folder_id), page_size)
                .await
                .ok_or_else(|| StorageError::Operation("failed to integrate port table".into()))?;
            Ok(())
        })
    }
}

async fn ensure_child_folders(
    hub: &mut DriveClient,
    parent_folder_id: &str,
    folder_names: &[String],
) -> Result<HashMap<String, String>, StorageError> {
    let names: Vec<String> = folder_names.to_vec();
    let folder_ids =
        check_or_create_folders(hub, names.clone(), Some(parent_folder_id.to_string()))
            .await
            .ok_or_else(|| {
                StorageError::Operation("failed to prepare google drive folders".into())
            })?;

    Ok(names.into_iter().zip(folder_ids.into_iter()).collect())
}

#[derive(Debug, Clone)]
pub struct UserAccessTokenInfo {
    pub refresh_token: String,
    pub token_type: Option<String>,
}

const SCOPES: &[&str; 1] = &["https://www.googleapis.com/auth/drive.file"];

pub static USER_ACCESS_TOKEN: Lazy<Mutex<Option<UserAccessTokenInfo>>> =
    Lazy::new(|| Mutex::new(None));
pub static USER_GOOGLE_AUTH: OnceCell<
    Authenticator<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> = OnceCell::const_new();

pub fn set_refresh_token(refresh_token: String, token_type: String) -> Result<(), ()> {
    if refresh_token.is_empty() || token_type.is_empty() {
        return Err(());
    }

    tracing::info!("set refresh token: {refresh_token}");
    let mut local_access_token = USER_ACCESS_TOKEN.lock().unwrap();
    let info = UserAccessTokenInfo {
        refresh_token: refresh_token.to_owned(),
        token_type: if token_type == "bearer" {
            Some(token_type.to_owned())
        } else {
            Some("bearer".to_owned())
        },
    };
    *local_access_token = Some(info);
    tokio::task::spawn(async move {
        proxy_https::proxy_server_https::setup_default_crypto_provider();
        let hub = create_client().await;
        if hub.is_none() {
            let _ = auth_server::open_auth_page();
        }
    });
    Ok(())
}

pub async fn create_auth() -> Option<
    Authenticator<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> {
    setup_default_crypto_provider();
    let token = match USER_ACCESS_TOKEN.lock().unwrap().clone() {
        Some(token) => token,
        None => {
            tracing::error!("USER_ACCESS_TOKEN is not set");
            return None;
        }
    };
    let provider_refresh_token = token.refresh_token;
    let token_type = token.token_type.unwrap_or("Bearer".to_string());
    let secret = yup_oauth2::authorized_user::AuthorizedUserSecret {
        client_id: match std::option_env!("GOOGLE_CLIENT_ID") {
            Some(id) => id.to_string(),
            None => {
                tracing::error!("failed to get google client id");
                return None;
            }
        },
        client_secret: match std::option_env!("GOOGLE_CLIENT_SECRET") {
            Some(secret) => secret.to_string(),
            None => {
                tracing::error!("failed to get google client secret");
                return None;
            }
        },
        refresh_token: provider_refresh_token,
        key_type: token_type,
    };

    let auth: Authenticator<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    > = match yup_oauth2::AuthorizedUserAuthenticator::builder(secret)
        .build()
        .await
    {
        Ok(auth) => auth,
        Err(e) => {
            tracing::error!("failed to create authenticator: {e:?}");
            return None;
        }
    };

    if let Err(e) = auth.token(SCOPES).await {
        tracing::error!("error: {e:?}")
    }

    return Some(auth);
}

pub async fn create_client() -> Option<
    DriveHub<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> {
    let auth = USER_GOOGLE_AUTH
        .get_or_init(|| async {
            match create_auth().await {
                Some(auth) => auth,
                None => {
                    tracing::error!("failed to create auth. retrying...");
                    let _ = auth_server::open_auth_page();
                    panic!("failed to create auth");
                }
            }
        })
        .await
        .clone();

    if let Err(e) = auth.force_refreshed_token(SCOPES).await {
        tracing::error!("error: {e:?}");
        return None;
    }

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

#[cfg(dev)]
#[allow(dead_code)]
pub async fn get_drive_file_list(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    page_size: i32,
) -> Option<Vec<String>> {
    let result = hub.files().list().page_size(page_size).doit().await;
    if let Err(e) = result {
        tracing::error!("Error: {e:?}");
        return None;
    }
    let result = result.unwrap();
    let files = result.1.files?;
    let mut file_list = Vec::<String>::new();

    for file in files {
        file_list.push(file.name.unwrap_or_default());
    }
    return Some(file_list);
}

pub async fn get_file_content(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    file_id: String,
) -> Option<Vec<u8>> {
    let result = hub.files().get(&file_id).param("alt", "media").doit().await;
    if let Err(e) = result {
        tracing::error!("Error: {e:?}");
        return None;
    }
    let result = result.unwrap();
    let content: Option<Vec<u8>> = match result.0.into_body().collect().await {
        Ok(bytes) => Some(bytes.to_bytes().into()),
        Err(e) => {
            tracing::error!("Error: {e:?}");
            None
        }
    };
    return content;
}

pub async fn get_file_list_in_folder(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
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
    let result = hub
        .files()
        .list()
        .q(&query)
        .page_size(page_size)
        .doit()
        .await;
    if let Err(e) = result {
        tracing::error!("Error: {e:?}");
        return None;
    }
    let result = result.unwrap();
    let files = result.1.files?;
    let mut file_list = Vec::<String>::new();

    for file in files {
        file_list.push(file.id.unwrap_or_default());
    }
    return Some(file_list);
}

pub async fn check_folder(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
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
    let result = hub.files().list().q(&query).doit().await;
    if let Err(e) = result {
        tracing::error!("Error: {e:?}");
        return None;
    }
    let result = result.unwrap();
    let files = result.1.files?;
    if files.is_empty() {
        return None;
    }
    return Some(files[0].id.clone().unwrap());
}

pub async fn check_or_create_folder(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    folder_name: String,
    parent_folder_id: Option<String>,
) -> Option<String> {
    let mime_type = GOOGLE_DRIVE_FOLDER_MIME_TYPE.to_string();

    let result = check_folder(hub, folder_name.clone(), parent_folder_id.clone()).await;
    if result.is_some() {
        return result;
    }

    let content = b"";

    let result = create_file(hub, folder_name, mime_type, content, parent_folder_id).await;
    return result;
}

pub async fn check_or_create_folders(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
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
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
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

pub async fn check_file(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
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
    let result = hub.files().list().q(&query).doit().await;
    if let Err(e) = result {
        tracing::error!("Error: {e:?}");
        return None;
    }
    let result = result.unwrap();
    let files = result.1.files?;
    if files.is_empty() {
        return None;
    }
    return Some(files[0].id.clone().unwrap());
}

pub async fn delete_file(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    file_id: String,
) -> bool {
    let result = hub.files().delete(&file_id).doit().await;
    if let Err(e) = result {
        tracing::error!("Error: {e:?}");
        return false;
    }
    return true;
}

pub async fn create_file(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    file_name: String,
    mime_type: String,
    content: &[u8],
    folder_id: Option<String>,
) -> Option<String> {
    let result = check_file(hub, file_name.clone(), mime_type.clone(), folder_id.clone()).await;
    if result.is_some() {
        return result;
    }

    let parent_folder_ids = folder_id.map(|id| vec![id]);

    let req = google_drive3::api::File {
        name: Some(file_name),
        mime_type: Some(mime_type.clone()),
        parents: parent_folder_ids,
        ..Default::default()
    };

    let create_result = hub
        .files()
        .create(req)
        .upload(std::io::Cursor::new(content), mime_type.parse().unwrap())
        .await;
    if let Err(e) = create_result {
        tracing::error!("Error: {e:?}");
        return None;
    }
    let create_result = create_result.unwrap();
    return create_result.1.id;
}

pub async fn create_or_replace_file(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    file_name: String,
    mime_type: String,
    content: &[u8],
    folder_id: Option<String>,
) -> Option<String> {
    if let Some(existing_id) =
        check_file(hub, file_name.clone(), mime_type.clone(), folder_id.clone()).await
    {
        let req = google_drive3::api::File {
            name: Some(file_name.clone()),
            mime_type: Some(mime_type.clone()),
            parents: folder_id.clone().map(|id| vec![id]),
            ..Default::default()
        };
        let update_result = hub
            .files()
            .update(req, &existing_id)
            .upload(std::io::Cursor::new(content), mime_type.parse().unwrap())
            .await;
        match update_result {
            Ok(_) => return Some(existing_id),
            Err(err) => {
                tracing::error!("failed to update existing google drive file: {err:?}");
                return None;
            }
        }
    }

    create_file(hub, file_name, mime_type, content, folder_id).await
}

pub async fn write_get_data_table(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    folder_id: Option<String>,
    table: crate::database::table::GetDataTableEncode,
) -> Option<String> {
    let mime_type = GOOGLE_DRIVE_AVRO_MIME_TYPE.to_string();
    let folder_name = MASTER_DATA_FOLDER_NAME.to_string();
    let master_folder_id = check_or_create_folder(hub, folder_name, folder_id.clone()).await?;

    for table_names in GET_DATA_TABLE_NAMES.clone() {
        let table_name = table_names.clone().parse::<GetDataTableEnum>();
        if let Ok(table_name) = table_name {
            let content: Vec<u8> = match table_name {
                GetDataTableEnum::MstShip => table.mst_ship.clone(),
                GetDataTableEnum::MstSlotItem => table.mst_slot_item.clone(),
                GetDataTableEnum::MstEquipExslotShip => table.mst_equip_exslot_ship.clone(),
                GetDataTableEnum::MstEquipExslot => table.mst_equip_exslot.clone(),
                GetDataTableEnum::MstEquipLimitExslot => table.mst_equip_limit_exslot.clone(),
                GetDataTableEnum::MstSlotItemEquipType => table.mst_slot_item_equip_type.clone(),
                GetDataTableEnum::MstEquipShip => table.mst_equip_ship.clone(),
                GetDataTableEnum::MstStype => table.mst_stype.clone(),
                GetDataTableEnum::MstUseItem => table.mst_use_item.clone(),
                GetDataTableEnum::MstMapArea => table.mst_map_area.clone(),
                GetDataTableEnum::MstMapInfo => table.mst_map_info.clone(),
                GetDataTableEnum::MstShipGraph => table.mst_ship_graph.clone(),
                GetDataTableEnum::MstShipUpgrade => table.mst_ship_upgrade.clone(),
            };
            let file_name = format!("{table_names}{AVRO_FILE_EXTENSION}");
            create_or_replace_file(
                hub,
                file_name,
                mime_type.clone(),
                content.as_slice(),
                Some(master_folder_id.clone()),
            )
            .await?;
        }
    }

    return Some(master_folder_id);
}

pub async fn write_port_table(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    folder_id: Option<String>,
    table: crate::database::table::PortTableEncode,
    maparea_id: i64,
    mapinfo_no: i64,
) -> Option<String> {
    let mime_type = GOOGLE_DRIVE_AVRO_MIME_TYPE.to_string();
    let folder_name = TRANSACTION_DATA_FOLDER_NAME.to_string();
    let transaction_folder_id = check_or_create_folder(hub, folder_name, folder_id.clone()).await?;
    
    // Create map-specific folder (e.g., "1-5" for maparea_id=1, mapinfo_no=5)
    let map_folder_name = format!("{}-{}", maparea_id, mapinfo_no);
    let map_folder_id = check_or_create_folder(hub, map_folder_name, Some(transaction_folder_id.clone())).await?;

    let utc = Utc::now().naive_utc();
    let jst = Tokyo.from_utc_datetime(&utc);
    let file_name = format!(
        "{}{}{}{}",
        jst.timestamp(),
        PORT_TABLE_FILE_NAME_SEPARATOR,
        Uuid::new_v4(),
        AVRO_FILE_EXTENSION
    );
    let folder_names = PORT_TABLE_NAMES.clone();
    let folder_map = match ensure_child_folders(hub, &map_folder_id, &folder_names).await {
        Ok(map) => map,
        Err(err) => {
            tracing::error!("failed to prepare port table folders: {err}");
            return None;
        }
    };

    for table_name_str in folder_names {
        let table_name = table_name_str.parse::<PortTableEnum>();
        if let Ok(table_name) = table_name {
            let content: Vec<u8> = match table_name {
                PortTableEnum::EnvInfo => table.env_info.clone(),
                PortTableEnum::Cells => table.cells.clone(),
                PortTableEnum::AirBase => table.airbase.clone(),
                PortTableEnum::PlaneInfo => table.plane_info.clone(),
                PortTableEnum::OwnSlotItem => table.own_slotitem.clone(),
                PortTableEnum::EnemySlotItem => table.enemy_slotitem.clone(),
                PortTableEnum::FriendSlotItem => table.friend_slotitem.clone(),
                PortTableEnum::OwnShip => table.own_ship.clone(),
                PortTableEnum::EnemyShip => table.enemy_ship.clone(),
                PortTableEnum::FriendShip => table.friend_ship.clone(),
                PortTableEnum::OwnDeck => table.own_deck.clone(),
                PortTableEnum::SupportDeck => table.support_deck.clone(),
                PortTableEnum::EnemyDeck => table.enemy_deck.clone(),
                PortTableEnum::FriendDeck => table.friend_deck.clone(),
                PortTableEnum::AirBaseAirAttack => table.airbase_airattack.clone(),
                PortTableEnum::AirBaseAirAttackList => table.airbase_airattack_list.clone(),
                PortTableEnum::AirBaseAssult => table.airbase_assult.clone(),
                PortTableEnum::CarrierBaseAssault => table.carrierbase_assault.clone(),
                PortTableEnum::ClosingRaigeki => table.closing_raigeki.clone(),
                PortTableEnum::FriendlySupportHourai => table.friendly_support_hourai.clone(),
                PortTableEnum::FriendlySupportHouraiList => {
                    table.friendly_support_hourai_list.clone()
                }
                PortTableEnum::Hougeki => table.hougeki.clone(),
                PortTableEnum::HougekiList => table.hougeki_list.clone(),
                PortTableEnum::MidnightHougeki => table.midnight_hougeki.clone(),
                PortTableEnum::MidnightHougekiList => table.midnight_hougeki_list.clone(),
                PortTableEnum::OpeningAirAttack => table.opening_airattack.clone(),
                PortTableEnum::OpeningAirAttackList => table.opening_airattack_list.clone(),
                PortTableEnum::OpeningRaigeki => table.opening_raigeki.clone(),
                PortTableEnum::OpeningTaisen => table.opening_taisen.clone(),
                PortTableEnum::OpeningTaisenList => table.opening_taisen_list.clone(),
                PortTableEnum::SupportAirattack => table.support_airattack.clone(),
                PortTableEnum::SupportHourai => table.support_hourai.clone(),
                PortTableEnum::Battle => table.battle.clone(),
            };
            let Some(folder_id) = folder_map.get(&table_name_str) else {
                continue;
            };
            create_file(
                hub,
                file_name.clone(),
                mime_type.clone(),
                content.as_slice(),
                Some(folder_id.clone()),
            )
            .await?;
        }
    }

    return Some(transaction_folder_id);
}

pub async fn integrate_port_table(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    folder_id: Option<String>,
    page_size: i32,
) -> Option<String> {
    let mime_type = GOOGLE_DRIVE_AVRO_MIME_TYPE.to_string();
    let folder_name = TRANSACTION_DATA_FOLDER_NAME.to_string();
    let integrated_folder_id = check_or_create_folder(hub, folder_name, folder_id.clone()).await?;

    let utc = Utc::now().naive_utc();
    let jst = Tokyo.from_utc_datetime(&utc);
    let file_name = format!(
        "{}{}{}{}",
        jst.timestamp(),
        PORT_TABLE_FILE_NAME_SEPARATOR,
        Uuid::new_v4(),
        AVRO_FILE_EXTENSION
    );
    let folder_names = PORT_TABLE_NAMES.clone();
    let folder_map = match ensure_child_folders(hub, &integrated_folder_id, &folder_names).await {
        Ok(map) => map,
        Err(err) => {
            tracing::error!("failed to prepare integration folders: {err}");
            return None;
        }
    };

    for table_name in folder_names {
        let Some(folder_id) = folder_map.get(&table_name) else {
            continue;
        };
        let file_id_list =
            get_file_list_in_folder(hub, Some(folder_id.clone()), page_size, mime_type.clone())
                .await;
        let file_content_list = if let Some(file_id_list) = file_id_list.clone() {
            if file_id_list.is_empty() || file_id_list.len() == 1 {
                continue;
            }
            let mut file_content_list = Vec::new();
            for file_id in file_id_list.iter() {
                // Await each call sequentially to avoid multiple mutable borrows
                if let Some(content) = get_file_content(hub, file_id.clone()).await {
                    file_content_list.push(content);
                }
            }
            Some(file_content_list)
        } else {
            continue;
        };
        if let Some(file_content_list) = file_content_list {
            if file_content_list.is_empty() {
                continue;
            }
            let integrated_content = if let Ok(table_name) =
                table_name.clone().parse::<PortTableEnum>()
            {
                match table_name {
                    PortTableEnum::EnvInfo => integrate::<EnvInfo>(file_content_list),
                    PortTableEnum::Cells => integrate::<Cells>(file_content_list),
                    PortTableEnum::AirBase => integrate::<AirBase>(file_content_list),
                    PortTableEnum::PlaneInfo => integrate::<PlaneInfo>(file_content_list),
                    PortTableEnum::OwnSlotItem => integrate::<OwnSlotItem>(file_content_list),
                    PortTableEnum::EnemySlotItem => integrate::<EnemySlotItem>(file_content_list),
                    PortTableEnum::FriendSlotItem => integrate::<FriendSlotItem>(file_content_list),
                    PortTableEnum::OwnShip => integrate::<OwnShip>(file_content_list),
                    PortTableEnum::EnemyShip => integrate::<EnemyShip>(file_content_list),
                    PortTableEnum::FriendShip => integrate::<FriendShip>(file_content_list),
                    PortTableEnum::OwnDeck => integrate::<OwnDeck>(file_content_list),
                    PortTableEnum::SupportDeck => integrate::<SupportDeck>(file_content_list),
                    PortTableEnum::EnemyDeck => integrate::<EnemyDeck>(file_content_list),
                    PortTableEnum::FriendDeck => integrate::<FriendDeck>(file_content_list),
                    PortTableEnum::AirBaseAirAttack => {
                        integrate::<AirBaseAirAttack>(file_content_list)
                    }
                    PortTableEnum::AirBaseAirAttackList => {
                        integrate::<AirBaseAirAttackList>(file_content_list)
                    }
                    PortTableEnum::AirBaseAssult => integrate::<AirBaseAssult>(file_content_list),
                    PortTableEnum::CarrierBaseAssault => {
                        integrate::<CarrierBaseAssault>(file_content_list)
                    }
                    PortTableEnum::ClosingRaigeki => integrate::<ClosingRaigeki>(file_content_list),
                    PortTableEnum::FriendlySupportHourai => {
                        integrate::<FriendlySupportHourai>(file_content_list)
                    }
                    PortTableEnum::FriendlySupportHouraiList => {
                        integrate::<FriendlySupportHouraiList>(file_content_list)
                    }
                    PortTableEnum::Hougeki => integrate::<Hougeki>(file_content_list),
                    PortTableEnum::HougekiList => integrate::<HougekiList>(file_content_list),
                    PortTableEnum::MidnightHougeki => {
                        integrate::<MidnightHougeki>(file_content_list)
                    }
                    PortTableEnum::MidnightHougekiList => {
                        integrate::<MidnightHougekiList>(file_content_list)
                    }
                    PortTableEnum::OpeningAirAttack => {
                        integrate::<OpeningAirAttack>(file_content_list)
                    }
                    PortTableEnum::OpeningAirAttackList => {
                        integrate::<OpeningAirAttackList>(file_content_list)
                    }
                    PortTableEnum::OpeningRaigeki => integrate::<OpeningRaigeki>(file_content_list),
                    PortTableEnum::OpeningTaisen => integrate::<OpeningTaisen>(file_content_list),
                    PortTableEnum::OpeningTaisenList => {
                        integrate::<OpeningTaisenList>(file_content_list)
                    }
                    PortTableEnum::SupportAirattack => {
                        integrate::<SupportAirattack>(file_content_list)
                    }
                    PortTableEnum::SupportHourai => integrate::<SupportHourai>(file_content_list),
                    PortTableEnum::Battle => integrate::<Battle>(file_content_list),
                }
            } else {
                Ok(Vec::new())
            };
            if let Ok(integrated_content) = integrated_content {
                if integrated_content.is_empty() {
                    continue;
                }
                create_file(
                    hub,
                    file_name.clone(),
                    mime_type.clone(),
                    integrated_content.as_slice(),
                    Some(folder_id.clone()),
                )
                .await?;
                for file_id in file_id_list.unwrap().iter() {
                    delete_file(hub, file_id.clone()).await;
                }
            } else {
                continue;
            }
        } else {
            continue;
        }
    }
    return Some(integrated_folder_id);
}
