use std::io;

// Migrate the unversioned legacy schema to the configs 0.5.0 schema.

pub(super) fn migrate(
    document: &mut toml_edit::DocumentMut,
    changes: &mut Vec<&'static str>,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(auth) = document
        .get_mut("app")
        .and_then(|item| item.as_table_mut())
        .and_then(|app| app.get_mut("auth"))
        .and_then(|item| item.as_table_mut())
    {
        if let Some(deny_auth) = auth.remove("deny_auth") {
            if auth.contains_key("allow_auth") {
                changes.push("app.auth.allow_auth retained; removed app.auth.deny_auth");
            } else {
                let deny_auth = deny_auth
                    .as_value()
                    .and_then(|value| value.as_bool())
                    .ok_or_else(|| {
                        io::Error::new(
                            io::ErrorKind::InvalidData,
                            "app.auth.deny_auth must be a boolean",
                        )
                    })?;
                auth.insert("allow_auth", toml_edit::value(!deny_auth));
                changes.push("app.auth.deny_auth -> app.auth.allow_auth (inverted)");
            }
        }
    }

    if let Some(asset_sync) = document
        .get_mut("app")
        .and_then(|item| item.as_table_mut())
        .and_then(|app| app.get_mut("asset_sync"))
        .and_then(|item| item.as_table_mut())
    {
        if asset_sync.remove("enable").is_some() {
            changes.push("removed obsolete app.asset_sync.enable");
        }
    }

    if let Some(kc_window) = document
        .get_mut("app")
        .and_then(|item| item.as_table_mut())
        .and_then(|app| app.get_mut("kc_window"))
        .and_then(|item| item.as_table_mut())
    {
        if kc_window.remove("window_title_bar_height").is_some() {
            changes.push("removed obsolete app.kc_window.window_title_bar_height");
        }
    }

    Ok(())
}
