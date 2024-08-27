use tokio::sync::oneshot;

mod pac_server;
mod proxy_server;
mod cmd_pac;
mod edit_pac;

#[tokio::main]
async fn main () {

    let proxy_address = "http://125.6.189.247";

    let (_tx_proxy, rx_proxy) = oneshot::channel::<()>();
    let (_tx_pac, rx_pac) = oneshot::channel::<()>();
    let (tx_proxy_log, _rx_proxy_log) = tokio::sync::mpsc::channel::<Vec<u8>>(32);

    let proxy_server_addr = proxy_server::serve_proxy(proxy_address.to_string(), 0, rx_proxy, tx_proxy_log).unwrap();
    let pac_server_addr = pac_server::serve_pac_file("proxy.pac".to_string(), 0, rx_pac).unwrap();

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