// client.connect()?;
//     client.set_activity(activity::Activity::new()
//         .state("foo")
//         .details("bar")
//     )?;
//     client.close()?;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::{env, sync::{LazyLock, Mutex}};
use dotenvy::dotenv;

static DISCORD_CLIENT: LazyLock<Mutex<Result<DiscordIpcClient, Box<dyn std::error::Error + Send + Sync>>>> = LazyLock::new(|| Mutex::new(init_client()));

pub fn init_client() -> Result<DiscordIpcClient, Box<dyn std::error::Error + Send + Sync>> {
    dotenv().expect(".env file not found");

    let mut client_id = "".to_string();
    for (key, value) in env::vars() {
        if key.eq("DISCORD_CLIENT_ID") {
            client_id = value;
        }
    }

    let client = DiscordIpcClient::new(&client_id);
    match client {
        Ok(client) => Ok(client),
        Err(e) => Err(e.to_string().into()),
    }
}

pub fn set_activity(state: &str, details: &str) {
    if DISCORD_CLIENT.lock().unwrap().is_err() {
        return;
    }
    let _ = DISCORD_CLIENT.lock().unwrap().as_mut().unwrap().set_activity(activity::Activity::new()
        .state(state)
        .details(details)
    );
}

pub fn connect() {
    if DISCORD_CLIENT.lock().unwrap().is_err() {
        return;
    }
    DISCORD_CLIENT.lock().unwrap().as_mut().unwrap().connect().unwrap();
}

pub fn close() {
    if DISCORD_CLIENT.lock().unwrap().is_err() {
        return;
    }
    DISCORD_CLIENT.lock().unwrap().as_mut().unwrap().close().unwrap();
}