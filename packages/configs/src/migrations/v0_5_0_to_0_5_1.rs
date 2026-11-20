// Migrate the configs 0.5.0 schema to the 0.5.1 schema.

pub(super) fn migrate(
    document: &mut toml_edit::DocumentMut,
    changes: &mut Vec<&'static str>,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(proxy) = document
        .get_mut("proxy")
        .and_then(|item| item.as_table_mut())
    {
        if proxy.remove("channel").is_some() {
            changes.push("removed obsolete proxy.channel");
        }

        if let Some(network) = proxy
            .get_mut("network")
            .and_then(|item| item.as_table_mut())
        {
            if network.remove("backend_crate").is_some() {
                changes.push("removed obsolete proxy.network.backend_crate");
            }
        }
    }

    if let Some(database) = document
        .get_mut("app")
        .and_then(|item| item.as_table_mut())
        .and_then(|app| app.get_mut("database"))
        .and_then(|item| item.as_table_mut())
    {
        if database.remove("allow_data_to_cloud").is_some() {
            changes.push("removed obsolete app.database.allow_data_to_cloud");
        }
        if database.remove("google_drive").is_some() {
            changes.push("removed obsolete app.database.google_drive");
        }
    }

    Ok(())
}
