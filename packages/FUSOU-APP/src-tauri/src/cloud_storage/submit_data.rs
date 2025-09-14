use kc_api::{
    database::table::{GetDataTable, PortTable},
    interface::cells::Cells,
};

use crate::{
    auth::{auth_server, supabase},
    cloud_storage::google_drive,
    util::get_user_env_id,
};

pub fn submit_get_data_table() {
    if !configs::get_user_configs_for_app()
        .database
        .get_allow_data_to_cloud()
    {
        return;
    }

    let get_data_table = GetDataTable::new();
    tokio::task::spawn(async move {
        match get_data_table.encode() {
            Ok(get_data_table_encode) => {
                let pariod_tag = supabase::get_period_tag().await;
                let hub = google_drive::create_client().await;
                match hub {
                    Some(mut hub) => {
                        let folder_name = vec!["fusou".to_string(), pariod_tag.clone()];
                        let folder_id = google_drive::check_or_create_folder_hierarchical(
                            &mut hub,
                            folder_name,
                            Some("root".to_string()),
                        )
                        .await;

                        let result = google_drive::write_get_data_table(
                            &mut hub,
                            folder_id,
                            get_data_table_encode,
                        )
                        .await;
                        if result.is_none() {
                            tracing::warn!("Failed to write get data table");
                        }
                    }
                    None => {
                        tracing::error!("Failed to create google drive client");
                    }
                };
            }
            Err(e) => {
                tracing::error!("Failed to encode get data table: {}", e);
            }
        }
    });
}

pub fn submit_port_table() {
    if !configs::get_user_configs_for_app()
        .database
        .get_allow_data_to_cloud()
    {
        return;
    }

    if Cells::reset_flag() {
        let cells = Cells::load();
        tokio::task::spawn(async move {
            let _guard: tokio::sync::MutexGuard<'static, ()> =
                google_drive::get_port_table_access_guard().await;

            let user_env = get_user_env_id().await;
            let timestamp = chrono::Utc::now().timestamp();
            let port_table = PortTable::new(cells, user_env, timestamp);
            Cells::reset();
            match port_table.encode() {
                Ok(port_table_encode) => {
                    let pariod_tag = supabase::get_period_tag().await;
                    let hub = google_drive::create_client().await;
                    match hub {
                        Some(mut hub) => {
                            let folder_name = vec!["fusou".to_string(), pariod_tag.clone()];
                            let folder_id = google_drive::check_or_create_folder_hierarchical(
                                &mut hub,
                                folder_name,
                                Some("root".to_string()),
                            )
                            .await;

                            let result = google_drive::write_port_table(
                                &mut hub,
                                folder_id,
                                port_table_encode,
                            )
                            .await;
                            if result.is_none() {
                                tracing::warn!("Failed to write port table");
                            }
                        }
                        None => {
                            tracing::error!("Failed to create google drive client");
                            let _ = auth_server::open_auth_page();
                        }
                    };
                }
                Err(e) => {
                    tracing::error!("Failed to encode port table: {}", e);
                }
            }
        });
    }
}
