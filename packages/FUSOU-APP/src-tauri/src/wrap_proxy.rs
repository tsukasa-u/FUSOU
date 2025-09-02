// use proxy::bidirectional_channel::{Master, Slave, StatusInfo};
use proxy_https::{
    bidirectional_channel::{Master, Slave, StatusInfo},
    edit_pac::edit_pac,
};
use tauri::Url;

use crate::{
    builder_setup::bidirectional_channel::{
        get_pac_bidirectional_channel, get_proxy_bidirectional_channel,
        get_proxy_log_bidirectional_channel,
    },
    cmd::native_cmd,
};

pub fn serve_proxy<R>(
    proxy_target: String,
    save_path: String,
    pac_path: String,
    ca_path: String,
    app: &tauri::AppHandle<R>,
    file_prefix: Option<String>,
) -> Result<Url, Box<dyn std::error::Error>>
where
    R: tauri::Runtime,
{
    let proxy_bidirectional_channel_slave: Slave<StatusInfo> =
        get_proxy_bidirectional_channel().clone_slave();
    let proxy_log_bidirectional_channel_master: Master<StatusInfo> =
        get_proxy_log_bidirectional_channel().clone_master();
    let pac_bidirectional_channel_slave: Slave<StatusInfo> =
        get_pac_bidirectional_channel().clone_slave();

    proxy_https::proxy_server_https::check_ca(ca_path.clone());

    native_cmd::add_store(app);

    // start proxy server
    // let save_path = "./../../FUSOU-PROXY-DATA".to_string();
    // let proxy_addr = proxy::proxy_server_http::serve_proxy(proxy_target, 0, proxy_bidirectional_channel_slave, proxy_log_bidirectional_channel_master, save_path);
    let proxy_addr = proxy_https::proxy_server_https::serve_proxy(
        0,
        proxy_bidirectional_channel_slave,
        proxy_log_bidirectional_channel_master,
        save_path,
        ca_path,
        file_prefix.unwrap_or("".to_string()),
    );

    if proxy_addr.is_err() {
        return Err("Failed to start proxy server".into());
    }

    // start pac server
    // let pac_addr = proxy::pac_server::serve_pac_file(pac_path.clone(), 0, pac_bidirectional_channel_slave);
    let pac_addr = proxy_https::pac_server::serve_pac_file(
        pac_path.clone(),
        0,
        pac_bidirectional_channel_slave,
    );

    if pac_addr.is_err() {
        return Err("Failed to start pac server".into());
    }

    // edit_pac(pac_path.as_str(), proxy_addr.unwrap().to_string().as_str());
    let host = if proxy_target.is_empty() {
        None
    } else {
        Some(proxy_target.as_str())
    };
    let proxy_addr_string = proxy_addr.unwrap().to_string();
    edit_pac(pac_path.as_str(), proxy_addr_string.clone().as_str(), host);

    native_cmd::add_pac(
        format!("http://localhost:{}/proxy.pac", pac_addr.unwrap().port()),
        app,
    );

    return Ok(Url::parse(&format!("http://{}", proxy_addr_string)).unwrap());
}
