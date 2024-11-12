use std::net::SocketAddr;

use proxy::bidirectional_channel::{Master, Slave, StatusInfo};

use crate::cmd_pac_tauri;

pub struct PacChannel {
    pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

pub struct ProxyChannel {
    pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

pub struct ProxyLogChannel {
    pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

pub struct ResponseParseChannel {
    pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

pub fn serve_proxy(proxy_target: String, pac_path: String, proxy_bidirectional_channel_slave: Slave<StatusInfo>, proxy_log_bidirectional_channel_master: Master<StatusInfo>, pac_bidirectional_channel_slave: Slave<StatusInfo>) -> Result<(), Box<dyn std::error::Error>> {
    // start proxy server
    let save_path = "./../../FUSOU-PROXY-DATA".to_string();
    let proxy_addr = proxy::proxy_server::serve_proxy(proxy_target, 0, proxy_bidirectional_channel_slave, proxy_log_bidirectional_channel_master, save_path);

    if proxy_addr.is_err() {
        return Err("Failed to start proxy server".into());
    }
    
    // start pac server
    let pac_addr = proxy::pac_server::serve_pac_file(pac_path.clone(), 0, pac_bidirectional_channel_slave);
    
    if pac_addr.is_err() {
        return Err("Failed to start pac server".into());
    }
    
    proxy::edit_pac::edit_pac(pac_path.as_str(), proxy_addr.unwrap().to_string().as_str());
      
    cmd_pac_tauri::add_pac(&format!("http://localhost:{}/proxy.pac", pac_addr.unwrap().port()));
    
    return Ok(());
}