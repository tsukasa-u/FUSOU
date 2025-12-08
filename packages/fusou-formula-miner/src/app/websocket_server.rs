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
  <!-- Plotly.js for advanced graph visualizations -->
  <script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; 
      background: #0f172a; 
      color: #e5e7eb;
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #1e293b, #0f172a);
      border-bottom: 1px solid #1e40af;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .title { font-size: 18px; font-weight: bold; }
    .status-badge {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #dc2626;
      margin-right: 8px;
      animation: pulse 2s infinite;
    }
    .status-badge.connected { background: #10b981; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    
    .container { display: flex; height: calc(100vh - 60px); }
    
    .main-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .sub-panel { width: 300px; border-left: 1px solid #1e40af; overflow-y: auto; }
    
    .section { 
      border-bottom: 1px solid #1e40af; 
      padding: 12px 16px;
      flex-shrink: 0;
    }
    
    .section-title { 
      font-size: 12px; 
      font-weight: bold; 
      color: #60a5fa; 
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat { background: #1e293b; padding: 8px; border-radius: 4px; }
    .stat-label { font-size: 10px; color: #9ca3af; }
    .stat-value { font-size: 16px; font-weight: bold; color: #38bdf8; margin-top: 4px; }
    
    .formula-box {
      background: #0f172a;
      border: 1px solid #1e40af;
      border-radius: 4px;
      padding: 8px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      word-break: break-all;
      max-height: 60px;
      overflow-y: auto;
    }
    
    .candidates-list {
      max-height: 200px;
      min-height: 80px;
      overflow-y: auto;
      font-size: 11px;
      border: 1px solid #334155;
      border-radius: 4px;
      background: #111827;
      padding-right: 4px;
    }
        .input-section {
          margin: 12px 0;
        }
        .input-label {
          font-size: 12px;
          color: #60a5fa;
          margin-bottom: 4px;
          display: block;
        }
        .input-area {
          width: 100%;
          min-height: 48px;
          max-height: 120px;
          resize: vertical;
          font-size: 13px;
          font-family: monospace;
          border: 1px solid #334155;
          border-radius: 4px;
          padding: 6px;
          background: #1e293b;
          color: #e5e7eb;
          margin-bottom: 4px;
          overflow-y: auto;
          box-sizing: border-box;
        }
    
    .candidate-item {
      padding: 6px 8px;
      border-left: 3px solid #38bdf8;
      background: #1e293b;
      margin-bottom: 4px;
      border-radius: 2px;
    }
    
    .candidate-rank { color: #60a5fa; font-weight: bold; }
    .candidate-formula { font-family: monospace; font-size: 10px; color: #d1d5db; margin: 2px 0; }
    .candidate-rmse { color: #10b981; font-weight: bold; }
    
    .clustering-info {
      background: #1e293b;
      padding: 8px;
      border-radius: 4px;
      font-size: 11px;
      max-height: 100px;
      overflow-y: auto;
    }
    
    .cluster-item {
      padding: 4px;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
    }
    
    .logs-panel {
      flex: 1;
      overflow-y: auto;
      background: #0f172a;
      border: 1px solid #1e40af;
      border-radius: 4px;
      padding: 8px;
      font-size: 11px;
      font-family: 'Courier New', monospace;
    }
    
    .log-entry {
      margin: 2px 0;
      padding: 2px 4px;
      border-radius: 2px;
    }
    
    .log-entry.info { color: #60a5fa; }
    .log-entry.success { color: #10b981; }
    .log-entry.error { color: #ef4444; }
    .log-entry.warning { color: #f59e0b; }
    
    .sub-panel > .section:last-child { border-bottom: none; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <span class="status-badge" id="status-badge"></span>
      <span class="title">⚗️ FUSOU Formula Miner Dashboard</span>
    </div>
    <div id="status-text" style="color: #60a5fa;">Connecting...</div>
  </div>
  
  <div class="container">
    <div class="main-panel">
      <!-- RMSE推移グラフ -->
      <div class="section">
        <div class="section-title">RMSE Progress</div>
        <div id="rmse-plot" style="height:160px;width:100%;background:#111827;border-radius:4px;"></div>
      </div>
      <!-- Solver Metrics -->
      <div class="input-section">
        <label class="input-label" for="dashboard-input">Input</label>
        <textarea id="dashboard-input" class="input-area" rows="3" placeholder="Enter your input here..."></textarea>
      </div>
      <div class="section">
        <div class="section-title">Solver Metrics</div>
        <div class="grid-2">
          <div class="stat">
            <div class="stat-label">Phase</div>
            <div class="stat-value" id="phase">-</div>
          </div>
          <div class="stat">
            <div class="stat-label">Generation</div>
            <div class="stat-value" id="generation">0</div>
          </div>
          <div class="stat">
            <div class="stat-label">Best RMSE</div>
            <div class="stat-value" id="rmse">∞</div>
          </div>
          <div class="stat">
            <div class="stat-label">Progress</div>
            <div class="stat-value" id="progress">0%</div>
          </div>
        </div>
      </div>
      
      <!-- データセット散布図 -->
      <div class="section">
        <div class="section-title">Dataset Scatter</div>
        <div id="dataset-plot" style="height:160px;width:100%;background:#111827;border-radius:4px;"></div>
      </div>
      <!-- Dataset Info -->
      <div class="section">
        <div class="section-title">Dataset</div>
        <div class="grid-2">
          <div class="stat">
            <div class="stat-label">Samples</div>
            <div class="stat-value" id="samples">0</div>
          </div>
          <div class="stat">
            <div class="stat-label">Features</div>
            <div class="stat-value" id="features">0</div>
          </div>
        </div>
        <div style="margin-top: 8px; font-size: 10px; color: #9ca3af;" id="target-formula"></div>
      </div>
      
      <!-- Best Formula -->
      <div class="section">
        <div class="section-title">Best Formula</div>
        <div class="formula-box" id="best-formula">Searching...</div>
      </div>
      
      <!-- Top Candidates -->
      <div class="section" style="display: flex; flex-direction: column; max-height: 240px;">
        <div class="section-title">Top Candidates (Top 5)</div>
        <div class="candidates-list" id="candidates" style="flex:1; min-height:80px; max-height:180px; overflow-y:auto;"></div>
      </div>
      
      <!-- Logs -->
      <div class="section" style="flex: 1; min-height: 200px; display: flex; flex-direction: column;">
        <div class="section-title">Event Log</div>
        <div class="logs-panel" id="event-log"></div>
      </div>
    </div>
    
    <!-- Right Panel -->
    <div class="sub-panel">
      <!-- クラスタ分布グラフ -->
      <div class="section" id="clustering-section" style="display: none;">
        <div class="section-title">Clustering</div>
        <div id="clustering-plot" style="height:160px;width:100%;background:#111827;border-radius:4px;"></div>
        <div class="clustering-info" id="clustering-info"></div>
      </div>
      
      <!-- Optimization Results -->
      <div class="section">
        <div class="section-title">Optimization Results</div>
        <div style="font-size: 11px;">
          <div style="margin-bottom: 8px;">
            <div style="color: #9ca3af; margin-bottom: 2px;">Best Error</div>
            <div style="font-size: 14px; color: #10b981; font-weight: bold;" id="best-error-final">∞</div>
          </div>
          <div>
            <div style="color: #9ca3af; margin-bottom: 2px;">Total Generations</div>
            <div style="font-size: 14px; color: #38bdf8; font-weight: bold;" id="total-generations">0</div>
          </div>
        </div>
      </div>
      
      <!-- Statistics -->
      <div class="section">
        <div class="section-title">Statistics</div>
        <div style="font-size: 11px;">
          <div style="padding: 4px 0; border-bottom: 1px solid #1e40af;">
            <span style="color: #9ca3af;">Target Error:</span>
            <span style="color: #60a5fa;" id="target-error">-</span>
          </div>
          <div style="padding: 4px 0;">
            <span style="color: #9ca3af;">Samples:</span>
            <span style="color: #60a5fa;" id="sample-count">0</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProto + '//localhost:8765';
    
    const statusBadge = document.getElementById('status-badge');
    const statusText = document.getElementById('status-text');
    const phaseEl = document.getElementById('phase');
    const generationEl = document.getElementById('generation');
    const rmseEl = document.getElementById('rmse');
    const progressEl = document.getElementById('progress');
    const samplesEl = document.getElementById('samples');
    const featuresEl = document.getElementById('features');
    const targetFormulaEl = document.getElementById('target-formula');
    const bestFormulaEl = document.getElementById('best-formula');
    const candidatesEl = document.getElementById('candidates');
    const eventLogEl = document.getElementById('event-log');
    const clusteringSection = document.getElementById('clustering-section');
    const clusteringInfoEl = document.getElementById('clustering-info');
    const bestErrorFinalEl = document.getElementById('best-error-final');
    const totalGenerationsEl = document.getElementById('total-generations');
    const targetErrorEl = document.getElementById('target-error');
    const sampleCountEl = document.getElementById('sample-count');

    function addLog(msg, type = 'info') {
      const entry = document.createElement('div');
      entry.className = 'log-entry ' + type;
      entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      eventLogEl.appendChild(entry);
      while (eventLogEl.children.length > 200) eventLogEl.removeChild(eventLogEl.firstChild);
      eventLogEl.scrollTop = eventLogEl.scrollHeight;
    }

    function connect() {
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        statusBadge.classList.add('connected');
        statusText.textContent = '✓ Connected';
        addLog('WebSocket connected', 'success');
      };
      
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          handleMessage(msg);
        } catch (err) {
          addLog('Parse error: ' + err.message, 'error');
        }
      };
      
      ws.onerror = () => {
        statusBadge.classList.remove('connected');
        statusText.textContent = '✗ Error';
        addLog('WebSocket error', 'error');
      };
      
      ws.onclose = () => {
        statusBadge.classList.remove('connected');
        statusText.textContent = '✗ Reconnecting...';
        addLog('Disconnected - reconnecting in 3s...', 'warning');
        setTimeout(connect, 3000);
      };
    }

    // --- 可視化用データ保持 ---
    let rmseHistory = [];
    let datasetScatter = { x: [], y: [] };
    let clusterScatter = { x: [], y: [], cluster: [] };

    function handleMessage(msg) {
      const data = msg.data || msg;
      const type = msg.event_type || msg.type;

      // Update solver metrics
      if (data.phase) phaseEl.textContent = data.phase;
      if (data.generation !== undefined) generationEl.textContent = data.generation;
      if (data.best_error !== undefined && data.best_error !== null) {
        const rmseVal = data.best_error === Infinity ? '∞' : data.best_error.toFixed(6);
        rmseEl.textContent = rmseVal;
        bestErrorFinalEl.textContent = rmseVal;
        // RMSE履歴を更新
        if (data.generation !== undefined && typeof data.best_error === 'number') {
          rmseHistory.push({ x: data.generation, y: data.best_error });
          if (rmseHistory.length > 200) rmseHistory.shift();
          drawRmsePlot();
        }
      }
      if (data.progress !== undefined) progressEl.textContent = (data.progress * 100).toFixed(1) + '%';

      // Update dataset info
      if (data.sample_count !== undefined) {
        samplesEl.textContent = data.sample_count;
        sampleCountEl.textContent = data.sample_count;
      }
      if (data.feature_count !== undefined) featuresEl.textContent = data.feature_count;
      if (data.target_formula) {
        targetFormulaEl.innerHTML = '<strong>Target:</strong> ' + data.target_formula;
      }

      // データセット散布図データ（例: x=feature0, y=target）
      if (data.dataset_scatter) {
        datasetScatter = data.dataset_scatter;
        drawDatasetPlot();
      }

      // Update formula
      if (data.formula || data.best_formula) {
        bestFormulaEl.textContent = data.formula || data.best_formula;
      }

      // Update candidates
      if (data.top_candidates && Array.isArray(data.top_candidates)) {
        candidatesEl.innerHTML = '';
        data.top_candidates.forEach((c, i) => {
          const div = document.createElement('div');
          div.className = 'candidate-item';
          div.innerHTML = '<div><span class="candidate-rank">#' + (i + 1) + '</span></div>' +
            '<div class="candidate-formula">' + c.formula + '</div>' +
            '<div class="candidate-rmse">RMSE: ' + c.rmse.toFixed(6) + '</div>';
          candidatesEl.appendChild(div);
        });
      }

      // クラスタ分布データ
      if (data.cluster_scatter) {
        clusterScatter = data.cluster_scatter;
        drawClusteringPlot();
      }

      // Update clustering info
      if (data.cluster_assignments !== undefined) {
        clusteringSection.style.display = 'block';
        if (data.cluster_assignments) {
          clusteringInfoEl.textContent = 'Clusters detected: ' + Object.keys(data.cluster_assignments).length;
        }
      }

      // Update target error
      if (data.target_error !== undefined) {
        targetErrorEl.textContent = data.target_error.toFixed(6);
      }

      // Update generation counter
      if (data.generation !== undefined) {
        totalGenerationsEl.textContent = data.generation;
      }

      // Log events
      if (type === 'best_formula') {
        addLog('🎯 New best: ' + (data.formula || data.best_formula) + ' (RMSE: ' + (data.rmse?.toFixed(6) || 'N/A') + ')', 'success');
      } else if (type === 'progress') {
        // Don't log every progress update
      } else if (type === 'completed') {
        addLog('✅ Optimization completed!', 'success');
      } else if (type === 'candidate') {
        // Don't log every candidate
      } else if (type === 'init') {
        addLog('📊 Dashboard initialized', 'info');
      }
    }

    // --- Plotly.jsグラフ描画関数 ---
    function drawRmsePlot() {
      const trace = {
        x: rmseHistory.map(p => p.x),
        y: rmseHistory.map(p => p.y),
        mode: 'lines+markers',
        type: 'scatter',
        line: { color: '#38bdf8' },
        marker: { size: 5 },
        name: 'RMSE'
      };
      Plotly.newPlot('rmse-plot', [trace], {
        margin: { t: 20, l: 40, r: 10, b: 40 },
        xaxis: { title: 'Generation', color: '#9ca3af', gridcolor: '#1e293b' },
        yaxis: { title: 'RMSE', color: '#9ca3af', gridcolor: '#1e293b' },
        paper_bgcolor: '#111827',
        plot_bgcolor: '#111827',
        font: { color: '#e5e7eb' },
      }, {displayModeBar: false});
    }

    function drawDatasetPlot() {
      if (!datasetScatter.x || !datasetScatter.y) return;
      const trace = {
        x: datasetScatter.x,
        y: datasetScatter.y,
        mode: 'markers',
        type: 'scatter',
        marker: { color: '#60a5fa', size: 6 },
        name: 'Dataset'
      };
      Plotly.newPlot('dataset-plot', [trace], {
        margin: { t: 20, l: 40, r: 10, b: 40 },
        xaxis: { title: 'Feature 0', color: '#9ca3af', gridcolor: '#1e293b' },
        yaxis: { title: 'Target', color: '#9ca3af', gridcolor: '#1e293b' },
        paper_bgcolor: '#111827',
        plot_bgcolor: '#111827',
        font: { color: '#e5e7eb' },
      }, {displayModeBar: false});
    }

    function drawClusteringPlot() {
      if (!clusterScatter.x || !clusterScatter.y || !clusterScatter.cluster) return;
      const uniqueClusters = [...new Set(clusterScatter.cluster)];
      const traces = uniqueClusters.map(cl => {
        const idx = clusterScatter.cluster.map((c, i) => c === cl ? i : -1).filter(i => i !== -1);
        return {
          x: idx.map(i => clusterScatter.x[i]),
          y: idx.map(i => clusterScatter.y[i]),
          mode: 'markers',
          type: 'scatter',
          marker: { size: 7 },
          name: 'Cluster ' + cl
        };
      });
      Plotly.newPlot('clustering-plot', traces, {
        margin: { t: 20, l: 40, r: 10, b: 40 },
        xaxis: { title: 'Feature 0', color: '#9ca3af', gridcolor: '#1e293b' },
        yaxis: { title: 'Feature 1', color: '#9ca3af', gridcolor: '#1e293b' },
        paper_bgcolor: '#111827',
        plot_bgcolor: '#111827',
        font: { color: '#e5e7eb' },
      }, {displayModeBar: false});
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
