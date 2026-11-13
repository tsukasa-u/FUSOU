use std::net::SocketAddr;
use configs::get_user_configs_for_proxy;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::bidirectional_channel;

pub fn serve_pac_file(
    path: String,
    port: u16,
    slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    serve_pac_file_with_handle(path, port, slave).map(|(addr, _handle)| addr)
}

pub fn serve_pac_file_with_handle(
    path: String,
    port: u16,
    mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) -> Result<(SocketAddr, tokio::task::JoinHandle<()>), Box<dyn std::error::Error>> {
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

    let bind_addr = SocketAddr::from(([127, 0, 0, 1], pac_port));
    let std_listener = std::net::TcpListener::bind(bind_addr)?;
    std_listener.set_nonblocking(true)?;
    let addr = std_listener.local_addr()?;
    tracing::info!("Pac server addr: {}", addr);

    let handle = tokio::task::spawn(async move {
        let listener = match TcpListener::from_std(std_listener) {
            Ok(l) => l,
            Err(e) => {
                tracing::error!("Failed to create tokio TcpListener for PAC: {}", e);
                return;
            }
        };

        let pac_path = pac_path;
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
                accept_res = listener.accept() => {
                    match accept_res {
                        Ok((mut socket, _peer_addr)) => {
                            let pac_file_path = pac_path.clone();
                            tokio::spawn(async move {
                                let mut buf = [0u8; 1024];
                                if let Ok(n) = socket.read(&mut buf).await {
                                    if n > 0 {
                                        let req = String::from_utf8_lossy(&buf[..n]);
                                        let is_pac_request = req.starts_with("GET /proxy.pac")
                                            || req.starts_with("GET / ");
                                        if is_pac_request {
                                            let content = tokio::fs::read(&pac_file_path).await.unwrap_or_default();
                                            let header = format!(
                                                "HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                                content.len()
                                            );
                                            let _ = socket.write_all(header.as_bytes()).await;
                                            let _ = socket.write_all(&content).await;
                                        } else {
                                            let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                                            let _ = socket.write_all(response.as_bytes()).await;
                                        }
                                        let _ = socket.shutdown().await;
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            tracing::debug!("Error accepting PAC connection: {}", e);
                        }
                    }
                }
            }
        }
        tracing::info!("Shutting down PAC server");
    });

    Ok((addr, handle))
}
