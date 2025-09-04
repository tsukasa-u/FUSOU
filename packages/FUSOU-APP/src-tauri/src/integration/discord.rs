#![allow(dead_code)]

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::{LazyLock, Mutex};

static DISCORD_CLIENT: LazyLock<
    Mutex<Result<DiscordIpcClient, Box<dyn std::error::Error + Send + Sync>>>,
> = LazyLock::new(|| Mutex::new(init_client()));

fn get_enable_integration() -> bool {
    configs::get_user_configs_for_app()
        .discord
        .get_enable_discord_integration()
}

pub fn init_client() -> Result<DiscordIpcClient, Box<dyn std::error::Error + Send + Sync>> {
    if get_enable_integration() {
        let client_id =
            std::option_env!("DISCORD_CLIENT_ID").expect("failed to get supabase database url");

        let client = DiscordIpcClient::new(client_id);
        match client {
            Ok(client) => Ok(client),
            Err(e) => Err(e.to_string().into()),
        }
    } else {
        Err("Discord integration is disabled".into())
    }
}

pub fn set_activity(state: &str, details: &str) {
    if DISCORD_CLIENT.lock().unwrap().is_err() || !get_enable_integration() {
        return;
    }

    if get_enable_integration() {
        let _ = DISCORD_CLIENT
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .set_activity(
                activity::Activity::new()
                    .state(state)
                    .details(details)
                    .timestamps(activity::Timestamps::new().start(0)),
            );
    }
}

pub fn set_activity_button(state: &str, details: &str, label: &str, url: &str) {
    if DISCORD_CLIENT.lock().unwrap().is_err() || !get_enable_integration() {
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

    let _ = DISCORD_CLIENT
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .set_activity(activity_payload);
}

pub fn connect() {
    if DISCORD_CLIENT.lock().unwrap().is_err() || !get_enable_integration() {
        return;
    }
    DISCORD_CLIENT
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .connect()
        .unwrap();
}

pub fn close() {
    if DISCORD_CLIENT.lock().unwrap().is_err() || !get_enable_integration() {
        return;
    }
    DISCORD_CLIENT
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .close()
        .unwrap();
}
