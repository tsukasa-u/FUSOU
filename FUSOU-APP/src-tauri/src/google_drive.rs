use chrono::{TimeZone, Utc};
use chrono_tz::Asia::Tokyo;
// use dotenvy_macro::dotenv;
use google_drive3::hyper_rustls;
use google_drive3::hyper_util;
use google_drive3::yup_oauth2;
use google_drive3::yup_oauth2::authenticator::Authenticator;
use google_drive3::DriveHub;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::OnceCell;
use uuid::Uuid;

use kc_api::database::airbase::{AirBase, PlaneInfo};
use kc_api::database::battle::{
    AirBaseAirAttack, AirBaseAirAttackList, AirBaseAssult, Battle, CarrierBaseAssault,
    ClosingRaigeki, FriendlySupportHourai, FriendlySupportHouraiList, Hougeki, HougekiList,
    MidnightHougeki, MidnightHougekiList, OpeningAirAttack, OpeningRaigeki, OpeningTaisen,
    OpeningTaisenList, SupportAirattack, SupportHourai,
};
use kc_api::database::cell::Cells;
use kc_api::database::deck::{EnemyDeck, FriendDeck, OwnDeck, SupportDeck};
use kc_api::database::ship::{EnemyShip, FriendShip, OwnShip};
use kc_api::database::slotitem::{EnemySlotItem, FriendSlotItem, OwnSlotItem};

use kc_api::interface::mst_equip_exslot_ship::MstEquipExslotShip;
use kc_api::interface::mst_equip_ship::MstEquipShip;
use kc_api::interface::mst_maparea::MstMapArea;
use kc_api::interface::mst_mapinfo::MstMapInfo;
use kc_api::interface::mst_ship::MstShip;
use kc_api::interface::mst_ship_graph::MstShipGraph;
use kc_api::interface::mst_ship_upgrade::MstShipUpgrade;
use kc_api::interface::mst_slot_item::MstSlotItem;
use kc_api::interface::mst_slot_item_equip_type::MstSlotItemEquipType;
use kc_api::interface::mst_stype::MstStype;
use kc_api::interface::mst_use_item::MstUseItem;

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
    println!("set refresh token: {}", refresh_token);
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
    Ok(())
}

pub static SURVICE_ACCESS_TOKEN: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

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
        client_id: std::env!("GOOGLE_CLIENT_ID").to_string(),
        // client_secret: dotenv!("GOOGLE_CLIENT_SECRET").to_string(),
        client_secret: std::env!("GOOGLE_CLIENT_SECRET").to_string(),
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
        println!("error: {:?}", e)
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
        println!("error: {:?}", e);
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
pub async fn get_drive_file_list(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    page_size: i32,
) -> Option<Vec<String>> {
    let result = hub.files().list().page_size(page_size).doit().await;
    if result.is_err() {
        println!("Error: {:?}", result);
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

pub async fn check_folder(
    hub: &mut DriveHub<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    >,
    folder_name: String,
    parent_folder_id: Option<String>,
) -> Option<String> {
    let query  = match parent_folder_id {
        Some(parent_folder_id) => format!(
            "mimeType='application/vnd.google-apps.folder' and name='{}' and trashed = false and '{}' in parents",
            folder_name, parent_folder_id
        ),
        None => format!(
            "mimeType='application/vnd.google-apps.folder' and name='{}' and trashed = false",
            folder_name
        ),
    };
    let result = hub.files().list().q(&query).doit().await;
    if result.is_err() {
        println!("Error: {:?}", result);
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
            "mimeType='{}' and name='{}' and trashed = false and '{}' in parents",
            mime_type, file_name, parent_folder_id
        ),
        None => format!(
            "mimeType='{}' and name='{}' and trashed = false",
            mime_type, file_name
        ),
    };
    let result = hub.files().list().q(&query).doit().await;
    if result.is_err() {
        println!("Error: {:?}", result);
        return None;
    }
    let result = result.unwrap();
    let files = result.1.files?;
    if files.is_empty() {
        return None;
    }
    return Some(files[0].id.clone().unwrap());
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
        println!("Error: {:?}", create_result);
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
        println!("Error: {:?}", create_result);
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
    let master_folder_id = check_or_create_folder(hub, folder_name, folder_id.clone()).await?;

    check_or_create_file(
        hub,
        MstShip::get_table_name(),
        mime_type.clone(),
        table.mst_ship.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;
    check_or_create_file(
        hub,
        MstSlotItem::get_table_name(),
        mime_type.clone(),
        table.mst_slot_item.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;
    check_or_create_file(
        hub,
        MstEquipExslotShip::get_table_name(),
        mime_type.clone(),
        table.mst_equip_exslot_ship.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;
    check_or_create_file(
        hub,
        MstSlotItemEquipType::get_table_name(),
        mime_type.clone(),
        table.mst_slot_item_equip_type.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;
    check_or_create_file(
        hub,
        MstEquipShip::get_table_name(),
        mime_type.clone(),
        table.mst_equip_ship.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;
    check_or_create_file(
        hub,
        MstStype::get_table_name(),
        mime_type.clone(),
        table.mst_stype.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;
    check_or_create_file(
        hub,
        MstUseItem::get_table_name(),
        mime_type.clone(),
        table.mst_use_item.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;
    check_or_create_file(
        hub,
        MstMapArea::get_table_name(),
        mime_type.clone(),
        table.mst_map_area.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;
    check_or_create_file(
        hub,
        MstMapInfo::get_table_name(),
        mime_type.clone(),
        table.mst_map_info.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;
    check_or_create_file(
        hub,
        MstShipGraph::get_table_name(),
        mime_type.clone(),
        table.mst_ship_graph.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;
    check_or_create_file(
        hub,
        MstShipUpgrade::get_table_name(),
        mime_type.clone(),
        table.mst_ship_upgrade.as_slice(),
        Some(master_folder_id.clone()),
    )
    .await?;

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
            let folder_name_vec = vec![
                Cells::get_table_name(),
                AirBase::get_table_name(),
                PlaneInfo::get_table_name(),
                OwnSlotItem::get_table_name(),
                EnemySlotItem::get_table_name(),
                FriendSlotItem::get_table_name(),
                OwnShip::get_table_name(),
                EnemyShip::get_table_name(),
                FriendShip::get_table_name(),
                OwnDeck::get_table_name(),
                EnemyDeck::get_table_name(),
                FriendDeck::get_table_name(),
                SupportDeck::get_table_name(),
                SupportAirattack::get_table_name(),
                OpeningAirAttack::get_table_name(),
                OpeningRaigeki::get_table_name(),
                OpeningTaisen::get_table_name(),
                OpeningTaisenList::get_table_name(),
                AirBaseAirAttack::get_table_name(),
                AirBaseAirAttackList::get_table_name(),
                AirBaseAssult::get_table_name(),
                CarrierBaseAssault::get_table_name(),
                FriendlySupportHourai::get_table_name(),
                FriendlySupportHouraiList::get_table_name(),
                Hougeki::get_table_name(),
                HougekiList::get_table_name(),
                MidnightHougeki::get_table_name(),
                MidnightHougekiList::get_table_name(),
                ClosingRaigeki::get_table_name(),
                Battle::get_table_name(),
            ];
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

    if let Some(folder_id) = folder_id_list.get(&Cells::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.cells.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&AirBase::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.airbase.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&PlaneInfo::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.plane_info.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&OwnSlotItem::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.own_slotitem.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&EnemySlotItem::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.enemy_slotitem.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&FriendSlotItem::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.friend_slotitem.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&OwnShip::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.own_ship.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&EnemyShip::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.enemy_ship.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&FriendShip::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.friend_ship.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&OwnDeck::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.own_deck.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&SupportDeck::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.support_deck.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&EnemyDeck::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.enemy_deck.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&FriendDeck::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.friend_deck.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&AirBaseAirAttack::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.airbase_airattack.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&AirBaseAirAttackList::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.airbase_airattack_list.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&AirBaseAssult::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.airbase_assult.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&CarrierBaseAssault::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.carrierbase_assault.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&ClosingRaigeki::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.closing_raigeki.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&FriendlySupportHourai::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.friendly_support_hourai.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&FriendlySupportHouraiList::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.friendly_support_hourai_list.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&Hougeki::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.hougeki.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&HougekiList::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.hougeki_list.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&MidnightHougeki::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.midnight_hougeki.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&MidnightHougekiList::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.midnight_hougeki_list.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&OpeningAirAttack::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.opening_airattack.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&OpeningRaigeki::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.opening_raigeki.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&OpeningTaisen::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.opening_taisen.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&OpeningTaisenList::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.opening_taisen_list.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&SupportAirattack::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.support_airattack.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&SupportHourai::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.support_hourai.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }
    if let Some(folder_id) = folder_id_list.get(&Battle::get_table_name()) {
        create_file(
            hub,
            file_name.clone(),
            mime_type.clone(),
            table.battle.as_slice(),
            Some(folder_id.clone()),
        )
        .await?;
    }

    return Some(transaction_folder_id);
}
