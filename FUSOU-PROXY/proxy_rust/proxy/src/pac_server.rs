use std::net::SocketAddr;

use warp::Filter;
use tokio::sync::oneshot::Receiver;

pub async fn serve_pac_file(path: String, port: u16, rx: Receiver<()>) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    // let pac_file = include_str!("../proxy.pac");

    let routes = warp::path("proxy.pac")
        .and(warp::path::end())
        .and(warp::fs::file(path));

    let (addr, server_pac) = warp::serve(routes).bind_with_graceful_shutdown(([127, 0, 0, 1], port), async move {
        tokio::select! {
            _ = rx => {},
            _ = tokio::signal::ctrl_c() => {},
        }
        println!("Shutting down PAC server");
    });
    println!("Pac server addr: {}", addr);

    tokio::task::spawn(server_pac);

    Ok(addr)
}