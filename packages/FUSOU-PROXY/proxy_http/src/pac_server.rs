use std::net::SocketAddr;

use warp::Filter;

use crate::bidirectional_channel;

pub fn serve_pac_file(path: String, port: u16, mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    // let pac_file = include_str!("../proxy.pac");

    let routes = warp::path("proxy.pac")
        .and(warp::path::end())
        .and(warp::fs::file(path));

    let (addr, server_pac) = warp::serve(routes).bind_with_graceful_shutdown(([127, 0, 0, 1], port), async move {
        loop {
            tokio::select! {
                recv_msg = slave.recv() => {
                    match recv_msg {
                        None => {
                            println!("Received None message");
                        },
                        Some(bidirectional_channel::StatusInfo::SHUTDOWN { status, message }) => {
                            println!("Received shutdown message: {} {}", status, message);
                            let _ = slave.send(bidirectional_channel::StatusInfo::SHUTDOWN {
                                status: "SHUTTING DOWN".to_string(),
                                message: "PAC server is shutting down".to_string(),
                            }).await;
                            break;
                        },
                        Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                            println!("Received health message: {} {}", status, message);
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
        println!("Shutting down PAC server");
    });
    println!("Pac server addr: {}", addr);

    tokio::task::spawn(server_pac);

    Ok(addr)
}