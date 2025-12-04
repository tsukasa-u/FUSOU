#[cfg(feature = "grpc")]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use std::net::SocketAddr;

    let bind_addr: SocketAddr = std::env::var("FUSOU_CHANNEL_BIND")
        .unwrap_or_else(|_| "0.0.0.0:50061".to_string())
        .parse()?;
    let buffer = std::env::var("FUSOU_CHANNEL_BUFFER")
        .ok()
        .and_then(|value| value.parse::<usize>().ok());

    proxy_https::grpc_channel::server::serve(bind_addr, buffer).await?;
    Ok(())
}

#[cfg(not(feature = "grpc"))]
fn main() {
    eprintln!(
        "The channel_service binary requires the `grpc` feature. Rebuild with `--features grpc`."
    );
}
