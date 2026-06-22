#![allow(dead_code)]

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::{LazyLock, Mutex};

static DISCORD_CLIENT: LazyLock<Mutex<Option<DiscordIpcClient>>> =
    LazyLock::new(|| Mutex::new(None));

fn get_enable_integration() -> bool {
    configs::get_user_configs_for_app()
        .discord
        .get_enable_discord_integration()
}

fn create_client() -> Result<DiscordIpcClient, String> {
    let Some(client_id) = std::option_env!("DISCORD_CLIENT_ID") else {
        return Err("failed to get DISCORD_CLIENT_ID env variable".to_string());
    };

    Ok(DiscordIpcClient::new(client_id))
}

fn ensure_client_initialized(client_slot: &mut Option<DiscordIpcClient>) -> bool {
    if client_slot.is_some() {
        return true;
    }

    match create_client() {
        Ok(client) => {
            *client_slot = Some(client);
            true
        }
        Err(e) => {
            tracing::error!("Failed to initialize Discord client: {}", e);
            false
        }
    }
}

pub fn connect() {
    if !get_enable_integration() {
        return;
    }

    let mut guard = DISCORD_CLIENT.lock().unwrap_or_else(|e| e.into_inner());
    if !ensure_client_initialized(&mut guard) {
        return;
    }

    if let Some(client) = guard.as_mut() {
        match client.connect() {
            Ok(_) => tracing::info!("Connected to Discord"),
            Err(e) => tracing::error!("Failed to connect to Discord: {}", e),
        }
    }
}

pub fn set_activity(state: &str, details: &str) {
    if !get_enable_integration() {
        return;
    }

    let mut guard = DISCORD_CLIENT.lock().unwrap_or_else(|e| e.into_inner());
    let Some(client) = guard.as_mut() else {
        tracing::debug!("Skipping Discord activity update because client is not initialized");
        return;
    };

    if let Err(e) = client.set_activity(
        activity::Activity::new()
            .state(state)
            .details(details)
            .timestamps(activity::Timestamps::new().start(0)),
    ) {
        tracing::error!("Failed to set Discord activity: {}", e);
    }
}

pub fn set_activity_button(state: &str, details: &str, label: &str, url: &str) {
    if !get_enable_integration() {
        return;
    }

    let elapsed_time =
        match std::time::SystemTime::now().duration_since(std::time::SystemTime::UNIX_EPOCH) {
            Ok(elapsed) => elapsed.as_secs() as i64,
            Err(_) => 0,
        };

    let buttons = vec![activity::Button::new(label, url)];
    let large_image = configs::get_user_configs_for_app()
        .discord
        .get_custom_image_url()
        .to_string();
    let custom_message = configs::get_user_configs_for_app()
        .discord
        .get_custom_message();
    let custom_details = configs::get_user_configs_for_app()
        .discord
        .get_custom_details();

    let activity_payload = if configs::get_user_configs_for_app()
        .discord
        .get_use_custom_message()
    {
        if configs::get_user_configs_for_app()
            .discord
            .get_use_custom_image()
        {
            activity::Activity::new()
                .state(&custom_message)
                .details(&custom_details)
                .timestamps(activity::Timestamps::new().start(elapsed_time))
                .assets(activity::Assets::new().large_image(large_image.as_str()))
        } else {
            activity::Activity::new()
                .state(&custom_message)
                .details(&custom_details)
                .timestamps(activity::Timestamps::new().start(elapsed_time))
        }
    } else {
        activity::Activity::new()
            .state(state)
            .details(details)
            .timestamps(activity::Timestamps::new().start(elapsed_time))
            .buttons(buttons)
    };

    let mut guard = DISCORD_CLIENT.lock().unwrap_or_else(|e| e.into_inner());
    let Some(client) = guard.as_mut() else {
        tracing::debug!("Skipping Discord activity update because client is not initialized");
        return;
    };

    if let Err(e) = client.set_activity(activity_payload) {
        tracing::error!("Failed to set Discord activity: {}", e);
    }
}

pub fn close() {
    let mut guard = DISCORD_CLIENT.lock().unwrap_or_else(|e| e.into_inner());
    let Some(client) = guard.as_mut() else {
        return;
    };

    if let Err(e) = client.clear_activity() {
        tracing::debug!("Failed to clear Discord activity before close: {}", e);
    }

    match client.close() {
        Ok(_) => tracing::info!("Disconnected from Discord"),
        Err(e) => tracing::error!("Failed to disconnect from Discord: {}", e),
    }

    *guard = None;
}
