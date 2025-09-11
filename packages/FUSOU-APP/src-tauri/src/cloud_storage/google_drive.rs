use chrono::{TimeZone, Utc};
use chrono_tz::Asia::Tokyo;
use google_drive3::{
    hyper_rustls, hyper_util, yup_oauth2, yup_oauth2::authenticator::Authenticator, DriveHub,
};
use http_body_util::BodyExt;
use once_cell::sync::Lazy;
use std::{collections::HashMap, sync::Mutex};
use tokio::sync::OnceCell;
use uuid::Uuid;

use kc_api::database::airbase::{AirBase, PlaneInfo};
use kc_api::database::battle::{
    AirBaseAirAttack, AirBaseAirAttackList, AirBaseAssult, Battle, CarrierBaseAssault,
    ClosingRaigeki, FriendlySupportHourai, FriendlySupportHouraiList, Hougeki, HougekiList,
    MidnightHougeki, MidnightHougekiList, OpeningAirAttack, OpeningAirAttackList, OpeningRaigeki,
    OpeningTaisen, OpeningTaisenList, SupportAirattack, SupportHourai,
};
use kc_api::database::cell::Cells;
use kc_api::database::deck::{EnemyDeck, FriendDeck, OwnDeck, SupportDeck};
use kc_api::database::ship::{EnemyShip, FriendShip, OwnShip};
use kc_api::database::slotitem::{EnemySlotItem, FriendSlotItem, OwnSlotItem};
use kc_api::database::table::{
    GetDataTableEnum, PortTableEnum, GET_DATA_TABLE_NAMES, PORT_TABLE_NAMES,
};
use kc_api::database::{env_info::EnvInfo, integrate::integrate};

use crate::auth::auth_server;

pub static GOOGLE_FOLDER_IDS: OnceCell<HashMap<String, String>> = OnceCell::const_new();

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

    println!("set refresh token: {refresh_token}");
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

// pub static SURVICE_ACCESS_TOKEN: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

// static CRYPTO_PROVIDER_LOCK: OnceLock<()> = OnceLock::new();

// fn setup_default_crypto_provider() {
//     CRYPTO_PROVIDER_LOCK.get_or_init(|| {
//         rustls::crypto::ring::default_provider()
//             .install_default()
//             .expect("Failed to install rustls crypto provider")
//     });
// }

pub async fn create_auth(
) -> Authenticator<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>
{
    // setup_default_crypto_provider();

    let provider_refresh_token = USER_ACCESS_TOKEN
        .lock()
        .unwrap()
        .clone()
        .unwrap()
        .refresh_token;

    let token_type = USER_ACCESS_TOKEN
        .lock()
        .unwrap()
        .clone()
        .unwrap()
        .token_type
        .unwrap_or("Bearer".to_string());

    let secret = yup_oauth2::authorized_user::AuthorizedUserSecret {
        // client_id: dotenv!("GOOGLE_CLIENT_ID").to_string(),
        client_id: std::option_env!("GOOGLE_CLIENT_ID")
            .expect("failed to get google client id")
            .to_string(),
        // client_secret: dotenv!("GOOGLE_CLIENT_SECRET").to_string(),
        client_secret: std::option_env!("GOOGLE_CLIENT_SECRET")
            .expect("failed to get google client secret")
            .to_string(),
        refresh_token: provider_refresh_token,
        key_type: token_type,
    };

    let auth: Authenticator<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    > = yup_oauth2::AuthorizedUserAuthenticator::builder(secret)
        .build()
        .await
        .expect("failed to create authenticator");

    if let Err(e) = auth.token(SCOPES).await {
        println!("error: {e:?}")
    }

    return auth;
}

pub async fn create_client() -> Option<
    DriveHub<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> {
    let auth = USER_GOOGLE_AUTH
        .get_or_init(|| async {
            let auth = create_auth().await;
            return auth;
        })
        .await
        .clone();

    if let Err(e) = auth.force_refreshed_token(SCOPES).await {
        println!("error: {e:?}");
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
    if result.is_err() {
        println!("Error: {result:?}");
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
    if result.is_err() {
        println!("Error: {result:?}");
        return None;
    }
    let result = result.unwrap();
    let content: Option<Vec<u8>> = match result.0.into_body().collect().await {
        Ok(bytes) => Some(bytes.to_bytes().into()),
        Err(e) => {
            println!("Error: {e:?}");
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
            "mimeType='{mime_type}' and trashed = false and '{parent_folder_id}' in parents"
        ),
        None => format!("mimeType='{mime_type}' and trashed = false",),
    };
    let result = hub
        .files()
        .list()
        .q(&query)
        .page_size(page_size)
        .doit()
        .await;
    if result.is_err() {
        println!("Error: {result:?}");
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
            "mimeType='application/vnd.google-apps.folder' and name='{folder_name}' and trashed = false and '{parent_folder_id}' in parents"
        ),
        None => format!(
            "mimeType='application/vnd.google-apps.folder' and name='{folder_name}' and trashed = false"
        ),
    };
    let result = hub.files().list().q(&query).doit().await;
    if result.is_err() {
        println!("Error: {result:?}");
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
    let mime_type = "application/vnd.google-apps.folder".to_string();

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
            "mimeType='{mime_type}' and name='{file_name}' and trashed = false and '{parent_folder_id}' in parents"
        ),
        None => format!(
            "mimeType='{mime_type}' and name='{file_name}' and trashed = false"
        ),
    };
    let result = hub.files().list().q(&query).doit().await;
    if result.is_err() {
        println!("Error: {result:?}");
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
    if result.is_err() {
        println!("Error: {result:?}");
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
    if create_result.is_err() {
        println!("Error: {create_result:?}");
        return None;
    }
    let create_result = create_result.unwrap();
    return create_result.1.id;
}

pub async fn check_or_create_file(
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
    if create_result.is_err() {
        println!("Error: {create_result:?}");
        return None;
    }
    let create_result = create_result.unwrap();
    return create_result.1.id;
}

pub async fn write_get_data_table(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    folder_id: Option<String>,
    table: crate::database::table::GetDataTableEncode,
) -> Option<String> {
    let mime_type = "application/avro".to_string();
    let folder_name = "master_data".to_string();
    let check_folder_result = check_folder(hub, folder_name.clone(), folder_id.clone()).await;
    if check_folder_result.is_some() {
        return None;
    }
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
            check_or_create_file(
                hub,
                table_names.clone(),
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
) -> Option<String> {
    let mime_type = "application/avro".to_string();
    let folder_name = "transaction_data".to_string();
    let transaction_folder_id = check_or_create_folder(hub, folder_name, folder_id.clone()).await?;

    let utc = Utc::now().naive_utc();
    let jst = Tokyo.from_utc_datetime(&utc);
    let file_name = format!("{}_{}", jst.timestamp(), Uuid::new_v4());

    let folder_id_list = GOOGLE_FOLDER_IDS
        .get_or_init(|| async {
            let folder_name_vec = PORT_TABLE_NAMES.clone();
            let folder_id_vec = check_or_create_folders(
                hub,
                folder_name_vec.clone(),
                Some(transaction_folder_id.clone()),
            )
            .await
            .unwrap();

            let folder_map: HashMap<String, String> = folder_name_vec
                .iter()
                .zip(folder_id_vec.iter())
                .map(|(name, id)| {
                    let name = name.clone();
                    let id = id.clone();
                    (name, id)
                })
                .collect();
            return folder_map;
        })
        .await
        .clone();

    for (folder_id_name, folder_id) in folder_id_list {
        let table_name = folder_id_name.clone().parse::<PortTableEnum>();
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
    let mime_type = "application/avro".to_string();
    let folder_name = "transaction_data".to_string();
    let integrated_folder_id = check_or_create_folder(hub, folder_name, folder_id.clone()).await?;

    let utc = Utc::now().naive_utc();
    let jst = Tokyo.from_utc_datetime(&utc);
    let file_name = format!("{}_{}", jst.timestamp(), Uuid::new_v4());
    let folder_id_list = GOOGLE_FOLDER_IDS
        .get_or_init(|| async {
            let folder_name_vec = PORT_TABLE_NAMES
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<String>>();
            let folder_id_vec = check_or_create_folders(
                hub,
                folder_name_vec.clone(),
                Some(integrated_folder_id.clone()),
            )
            .await
            .unwrap();

            let folder_map: HashMap<String, String> = folder_name_vec
                .iter()
                .zip(folder_id_vec.iter())
                .map(|(name, id)| {
                    let name = name.clone();
                    let id = id.clone();
                    (name, id)
                })
                .collect();
            return folder_map;
        })
        .await
        .clone();
    for (folder_name, folder_id) in folder_id_list.iter() {
        let file_id_list =
            get_file_list_in_folder(hub, Some(folder_id.clone()), page_size, mime_type.clone())
                .await;
        let file_content_list = if let Some(file_id_list) = file_id_list.clone() {
            if file_id_list.is_empty() || file_id_list.len() == 1 {
                return None;
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
            return None;
        };
        if let Some(file_content_list) = file_content_list {
            if file_content_list.is_empty() {
                return None;
            }
            let integrated_content = if let Ok(table_name) =
                folder_name.clone().parse::<PortTableEnum>()
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
                    return None;
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
                return None;
            }
        } else {
            return None;
        }
    }
    return Some(integrated_folder_id);
}
