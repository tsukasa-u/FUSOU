use crate::state::DashboardEvent;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_async;
use futures::{SinkExt, StreamExt};
use serde_json::json;

const DASHBOARD_HTML: &str = include_str!("../static/dashboard.html");

/// Start HTTP and WebSocket servers on the same port
pub async fn run_ws_server(
    host: &str,
    port: u16,
    dashboard_tx: broadcast::Sender<DashboardEvent>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Spawn HTTP server on port+1 (e.g., 8766 if WebSocket is 8765)
    let http_port = port + 1;
    let http_host = host.to_string();
    tokio::spawn(async move {
        if let Err(e) = run_http_server(&http_host, http_port).await {
            eprintln!("HTTP server error: {}", e);
        }
    });

    // Main WebSocket server loop on specified port
    let addr = format!("{}:{}", host, port);
    let listener = TcpListener::bind(&addr).await?;
    eprintln!("📡 WebSocket server listening on ws://{}", addr);

    loop {
        let (stream, peer_addr) = listener.accept().await?;
        let dashboard_tx = dashboard_tx.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_client(stream, peer_addr, dashboard_tx).await {
                eprintln!("WebSocket client error: {}", e);
            }
        });
    }
}

/// Simple HTTP server to serve the dashboard HTML
async fn run_http_server(
    host: &str,
    port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let addr = format!("{}:{}", host, port);
    let listener = TcpListener::bind(&addr).await?;
    eprintln!("📡 HTTP server listening on http://{}", addr);

    loop {
        let (mut stream, _) = listener.accept().await?;
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buffer = [0; 512];
            let _ = stream.read(&mut buffer).await;

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
                DASHBOARD_HTML.len(),
                DASHBOARD_HTML
            );
            let _ = stream.write_all(response.as_bytes()).await;
        });
    }
}

async fn handle_client(
    stream: TcpStream,
    _peer_addr: std::net::SocketAddr,
    dashboard_tx: broadcast::Sender<DashboardEvent>,
) -> Result<(), Box<dyn std::error::Error>> {
    let ws_stream = accept_async(stream).await?;
    // eprintln!("✓ Dashboard connected from {}", peer_addr); // TUIレイアウト崩れ防止のため出力抑制
    let (mut sender, mut receiver) = ws_stream.split();
    let mut rx = dashboard_tx.subscribe();
    
    // Send initial handshake
    let init_msg = json!({
        "type": "init",
        "data": {
            "phase": "idle",
            "generation": 0,
            "best_error": f64::INFINITY,
            "best_formula": "Searching...",
            "progress": 0.0,
            "sample_count": 0,
            "feature_count": 0,
            "target_error": 0.001,
            "top_candidates": [],
            "cluster_assignments": null,
        }
    });
    let _ = sender.send(tokio_tungstenite::tungstenite::Message::Text(init_msg.to_string())).await;
    
    // Forward events from broadcast channel to WebSocket
    loop {
        tokio::select! {
            msg_result = receiver.next() => {
                match msg_result {
                    Some(Ok(msg)) => {
                        // Handle incoming messages (if any)
                        match msg {
                            tokio_tungstenite::tungstenite::Message::Close(_) => {
                                // eprintln!("Dashboard disconnected: {}", peer_addr); // TUIレイアウト崩れ防止のため出力抑制
                                break;
                            }
                            _ => {}
                        }
                    }
                    Some(Err(e)) => {
                        eprintln!("WebSocket error: {}", e);
                        break;
                    }
                    None => {
                        break;
                    }
                }
            }
            event_result = rx.recv() => {
                match event_result {
                    Ok(event) => {
                        let msg = json!(event);
                        if sender.send(tokio_tungstenite::tungstenite::Message::Text(msg.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => {
                        // Broadcast channel closed
                        break;
                    }
                }
            }
        }
    }
    
    Ok(())
}
