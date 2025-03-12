// use proxy::bidirectional_channel::{Master, Slave, StatusInfo};
use proxy_https::{
    bidirectional_channel::{Master, Slave, StatusInfo},
    edit_pac::edit_pac,
};

use crate::cmd;

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
    // pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

pub fn serve_proxy(proxy_target: String, save_path: String, pac_path: String, ca_path: String, proxy_bidirectional_channel_slave: Slave<StatusInfo>, proxy_log_bidirectional_channel_master: Master<StatusInfo>, pac_bidirectional_channel_slave: Slave<StatusInfo>) -> Result<(), Box<dyn std::error::Error>> {

    proxy_https::proxy_server_https::check_ca(ca_path.clone());

    cmd::add_store();

    // start proxy server
    // let save_path = "./../../FUSOU-PROXY-DATA".to_string();
    // let proxy_addr = proxy::proxy_server_http::serve_proxy(proxy_target, 0, proxy_bidirectional_channel_slave, proxy_log_bidirectional_channel_master, save_path);
    let proxy_addr = proxy_https::proxy_server_https::serve_proxy(0, proxy_bidirectional_channel_slave, proxy_log_bidirectional_channel_master, save_path, ca_path);

    if proxy_addr.is_err() {
        return Err("Failed to start proxy server".into());
    }
    
    // start pac server
    // let pac_addr = proxy::pac_server::serve_pac_file(pac_path.clone(), 0, pac_bidirectional_channel_slave);
    let pac_addr = proxy_https::pac_server::serve_pac_file(pac_path.clone(), 0, pac_bidirectional_channel_slave);
    
    if pac_addr.is_err() {
        return Err("Failed to start pac server".into());
    }
    
    // edit_pac(pac_path.as_str(), proxy_addr.unwrap().to_string().as_str());
    let host =if proxy_target.is_empty() {
        None
    } else {
        Some(proxy_target.as_str())
    };
    edit_pac(pac_path.as_str(), proxy_addr.unwrap().to_string().as_str(), host);
    
    cmd::add_pac(&format!("http://localhost:{}/proxy.pac", pac_addr.unwrap().port()));
    
    return Ok(());
}