use crate::{
    auth::{auth_server, supabase},
    cloud_storage::google_drive,
};

pub fn integrate_port_table() {
    if !configs::get_user_configs_for_app()
        .database
        .get_allow_data_to_cloud()
    {
        return;
    }

    tokio::task::spawn(async move {
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

                // to figure out how many pages is best
                let result = google_drive::integrate_port_table(&mut hub, folder_id, 32).await;
                if result.is_none() {
                    println!("\x1b[38;5;{}m Failed to integrate port table\x1b[m ", 8);
                }
            }
            None => {
                println!(
                    "\x1b[38;5;{}m Failed to create google drive client\x1b[m ",
                    8
                );
                let _ = auth_server::open_auth_page();
            }
        };
    });
}
