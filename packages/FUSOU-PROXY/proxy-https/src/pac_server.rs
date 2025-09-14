use std::net::SocketAddr;

use configs::get_user_configs_for_proxy;
use warp::Filter;

use crate::bidirectional_channel;

pub fn serve_pac_file(
    path: String,
    port: u16,
    mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    let configs = get_user_configs_for_proxy();
    let use_custom_pac = configs.pac.get_use_custom_pac();
    let pac_path = if use_custom_pac {
        configs.pac.get_pac_script().unwrap_or(path)
    } else {
        path
    };
    let pac_port = match (port, configs.pac.get_pac_server_port()) {
        (0, 0) => 0,
        (0, port) => port,
        (port, _) => port,
    };

    let routes = warp::path("proxy.pac")
        .and(warp::path::end())
        .and(warp::fs::file(pac_path));

    let (addr, server_pac) = warp::serve(routes).bind_with_graceful_shutdown(([127, 0, 0, 1], pac_port), async move {
        loop {
            tokio::select! {
                recv_msg = slave.recv() => {
                    match recv_msg {
                        None => {
                            tracing::warn!("Received None message");
                        },
                        Some(bidirectional_channel::StatusInfo::SHUTDOWN { status, message }) => {
                            tracing::info!("Received shutdown message: {} {}", status, message);
                            let _ = slave.send(bidirectional_channel::StatusInfo::SHUTDOWN {
                                status: "SHUTTING DOWN".to_string(),
                                message: "PAC server is shutting down".to_string(),
                            }).await;
                            break;
                        },
                        Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                            tracing::info!("Received health message: {} {}", status, message);
                            let _ = slave.send(bidirectional_channel::StatusInfo::HEALTH {
                                status: "RUNNING".to_string(),
                                message: "PAC server is running".to_string(),
                            }).await;
                        },
                        _ => {}
                    }
                },
                _ = tokio::signal::ctrl_c() => {
                    break;
                },
            }
        }
        tracing::info!("Shutting down PAC server");
    });
    tracing::info!("Pac server addr: {}", addr);

    tokio::task::spawn(server_pac);

    Ok(addr)
}
