// client.connect()?;
//     client.set_activity(activity::Activity::new()
//         .state("foo")
//         .details("bar")
//     )?;
//     client.close()?;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::env;
use dotenvy::dotenv;

pub fn init_client() -> Result<DiscordIpcClient, Box<dyn std::error::Error>> {
    dotenv().expect(".env file not found");

    let mut client_id = "".to_string();
    for (key, value) in env::vars() {
        if key.eq("DISCORD_CLIENT_ID") {
            client_id = value;
        }
    }

    let client = DiscordIpcClient::new(&client_id);
    client
}

pub fn set_activity(client: &mut DiscordIpcClient, state: &str, details: &str) -> Result<(), Box<dyn std::error::Error>> {
    client.set_activity(activity::Activity::new()
        .state(state)
        .details(details)
    )?;
    Ok(())
}

pub fn connect(client: &mut DiscordIpcClient) -> Result<(), Box<dyn std::error::Error>> {
    client.connect()?;
    Ok(())
}

pub fn close(client: &mut DiscordIpcClient) -> Result<(), Box<dyn std::error::Error>> {
    client.close()?;
    Ok(())
}