use crate::state::DashboardEvent;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_async;
use futures::{SinkExt, StreamExt};
use serde_json::json;

const DASHBOARD_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FUSOU Formula Mining Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; font-family: monospace; background: #1a1a1a; color: #e0e0e0; }
    h1 { text-align: center; margin-top: 0; }
    .container { max-width: 1200px; margin: 0 auto; }
    .status { background: #222; padding: 10px; border-radius: 4px; margin-bottom: 20px; }
    .status.connected { border-left: 4px solid #4ade80; }
    .status.disconnected { border-left: 4px solid #ef4444; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
    .card { background: #222; padding: 15px; border-radius: 4px; border: 1px solid #333; }
    .label { color: #999; font-size: 12px; }
    .value { font-size: 20px; font-weight: bold; margin-top: 5px; }
    .formula { background: #111; padding: 10px; border-radius: 4px; font-size: 14px; word-break: break-all; }
    .log { background: #111; padding: 10px; border-radius: 4px; height: 300px; overflow-y: auto; border: 1px solid #333; }
    .log-entry { margin: 2px 0; padding: 2px 0; border-bottom: 1px solid #222; }
    .log-entry.info { color: #60a5fa; }
    .log-entry.success { color: #4ade80; }
  </style>
</head>
<body>
  <div class="container">
    <h1>⚗️ FUSOU Formula Miner Dashboard</h1>
    
    <div class="status disconnected" id="status">
      <span id="status-text">Connecting...</span>
    </div>
    
    <div class="grid">
      <div class="card">
        <div class="label">Phase</div>
        <div class="value" id="phase">-</div>
      </div>
      <div class="card">
        <div class="label">Generation</div>
        <div class="value" id="generation">0</div>
      </div>
      <div class="card">
        <div class="label">Best RMSE</div>
        <div class="value" id="rmse">∞</div>
      </div>
      <div class="card">
        <div class="label">Progress</div>
        <div class="value" id="progress">0%</div>
      </div>
    </div>
    
    <div class="card">
      <div class="label">Best Formula</div>
      <div class="formula" id="formula">Searching...</div>
    </div>
    
    <div style="margin-top: 20px;">
      <div class="label">Recent Events</div>
      <div class="log" id="log"></div>
    </div>
  </div>

  <script>
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProto + '//localhost:8765';  // WebSocket on port 8765, HTTP on 8766
    const status = document.getElementById('status');
    const statusText = document.getElementById('status-text');
    const phaseEl = document.getElementById('phase');
    const generationEl = document.getElementById('generation');
    const rmseEl = document.getElementById('rmse');
    const progressEl = document.getElementById('progress');
    const formulaEl = document.getElementById('formula');
    const logEl = document.getElementById('log');

    function addLog(msg, type = 'info') {
      const entry = document.createElement('div');
      entry.className = 'log-entry ' + type;
      entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      logEl.appendChild(entry);
      while (logEl.children.length > 100) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function connect() {
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        status.classList.remove('disconnected');
        status.classList.add('connected');
        statusText.textContent = '✓ Connected';
        addLog('WebSocket connected', 'success');
      };
      
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          
          if (msg.type === 'init' || msg.event_type) {
            const data = msg.data || msg;
            
            if (data.phase) phaseEl.textContent = data.phase;
            if (data.generation !== undefined) generationEl.textContent = data.generation;
            if (data.best_error !== undefined) rmseEl.textContent = data.best_error === Infinity ? '∞' : data.best_error.toFixed(6);
            if (data.progress !== undefined) progressEl.textContent = (data.progress * 100).toFixed(1) + '%';
            if (data.formula || data.best_formula) formulaEl.textContent = data.formula || data.best_formula;
            
            const type = msg.event_type || msg.type;
            if (type === 'best_formula') {
              addLog('🎯 Best: ' + (data.formula || data.best_formula), 'success');
            } else if (type === 'progress') {
              addLog('📈 Gen ' + data.generation, 'info');
            } else if (type === 'completed') {
              addLog('✅ Completed!', 'success');
            }
          }
        } catch (err) {
          addLog('Error: ' + err.message, 'error');
        }
      };
      
      ws.onerror = () => {
        status.classList.remove('connected');
        status.classList.add('disconnected');
        statusText.textContent = '✗ Error';
        addLog('WebSocket error', 'error');
      };
      
      ws.onclose = () => {
        status.classList.remove('connected');
        status.classList.add('disconnected');
        statusText.textContent = '✗ Disconnected - Reconnecting in 3s...';
        addLog('Disconnected. Reconnecting...', 'info');
        setTimeout(connect, 3000);
      };
    }
    
    addLog('Starting dashboard...', 'info');
    connect();
  </script>
</body>
</html>"#;

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
    
    // Run WebSocket server on the specified port
    let addr = format!("{}:{}", host, port);
    let listener = TcpListener::bind(&addr).await?;
    
    println!("🌐 Dashboard: http://localhost:{}", http_port);
    eprintln!("📡 WebSocket server listening on ws://{}", addr);
    
    loop {
        let (stream, peer_addr) = listener.accept().await?;
        let tx_clone = dashboard_tx.clone();
        
        tokio::spawn(async move {
            if let Err(e) = handle_client(stream, peer_addr, tx_clone).await {
                eprintln!("WebSocket client error: {}", e);
            }
        });
    }
}

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
            use tokio::io::AsyncWriteExt;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
                DASHBOARD_HTML.len(),
                DASHBOARD_HTML
            );
            let _ = stream.write_all(response.as_bytes()).await;
        });
    }
}

async fn handle_client(
    stream: TcpStream,
    peer_addr: std::net::SocketAddr,
    dashboard_tx: broadcast::Sender<DashboardEvent>,
) -> Result<(), Box<dyn std::error::Error>> {
    let ws_stream = accept_async(stream).await?;
    eprintln!("✓ Dashboard connected from {}", peer_addr);
    
    let (mut sender, mut receiver) = ws_stream.split();
    let mut rx = dashboard_tx.subscribe();
    
    // Send initial handshake
    let init_msg = json!({
        "type": "init",
        "data": {
            "phase": "ready",
            "generation": 0,
            "best_error": f64::INFINITY,
            "best_formula": "searching...",
            "progress": 0.0,
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
                                eprintln!("Dashboard disconnected: {}", peer_addr);
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
