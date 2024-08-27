use tokio::sync::mpsc;

use proxy::pac_server;
use proxy::proxy_server;
use proxy::cmd_pac;
use proxy::edit_pac;
use proxy::bidirectional_channel::{BidirectionalChannel, StatusInfo};

#[tokio::main]
async fn main () {

    let proxy_bidirectional_channel = BidirectionalChannel::<StatusInfo>::new(1);
    let proxy_bidirectional_channel_slave = proxy_bidirectional_channel.clone_slave();
    let proxy_bidirectional_channel_master = proxy_bidirectional_channel.clone_master();
    let proxy_target = "http://125.6.189.247";
  
    let pac_bidirectional_channel = BidirectionalChannel::<StatusInfo>::new(1);
    let pac_bidirectional_channel_slave = pac_bidirectional_channel.clone_slave();
    let pac_bidirectional_channel_master = pac_bidirectional_channel.clone_master();
    let pac_path = "./../../FUSOU-PROXY/proxy_rust/proxy/proxy.pac".to_string();

    let (proxy_log_channel_tx, proxy_log_channel_rx) = mpsc::channel::<Vec<u8>>(1);

    let proxy_server_addr = proxy_server::serve_proxy(proxy_target.to_string(), 0, proxy_bidirectional_channel_slave, proxy_log_channel_tx).unwrap();
    let pac_server_addr = pac_server::serve_pac_file("proxy.pac".to_string(), 0, pac_bidirectional_channel_slave).unwrap();

    edit_pac::edit_pac("proxy.pac", proxy_server_addr.to_string().as_str());
    cmd_pac::add_pac(&format!("http://localhost:{}/proxy.pac", pac_server_addr.port()));

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {},
    }
    println!("input 'exit' to exit");

    cmd_pac::remove_pac();
    
    loop {
        let mut input = String::new();
        std::io::stdin().read_line(&mut input).unwrap();
        if input.trim() == "exit" {
            break;
        }
    }
}