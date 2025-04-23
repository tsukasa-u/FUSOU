#[cfg(dev)]
#[tokio::main]
pub async fn test() {
    // use crate::google_drive;

    // println!("start google drive");
    // let hub = crate::google_drive::create_client().await;
    // if let Some(mut hub) = hub {
    //     println!("hub created");
    //     let pariod_tag = crate::supabase::get_period_tag().await;
    //     println!("tag: {:?}", pariod_tag);
    //     let folder_name = vec!["fusou".to_string(), pariod_tag.clone()];
    //     let folder_id = google_drive::check_or_create_folder_hierarchical(
    //         &mut hub,
    //         folder_name,
    //         Some("root".to_string()),
    //     )
    //     .await;

    //     println!("folder_id: {:?}", folder_id);

    //     // let result = google_drive::write_port_table(&mut hub, folder_id, port_table_encode).await;
    //     // if result.is_none() {
    //     //     println!("\x1b[38;5;{}m Failed to write port table\x1b[m ", 8);
    //     // }
    // } else {
    //     println!("hub is none");
    // }
}
