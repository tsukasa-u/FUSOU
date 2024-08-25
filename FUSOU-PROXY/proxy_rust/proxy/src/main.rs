use tokio::sync::oneshot;

mod pac_server;
mod proxy_server;
mod cmd_pac;

#[tokio::main]
async fn main () {
    
    cmd_pac::add_pac("http://localhost:8000/proxy.pac");

    let proxy_address = "http://125.6.189.247";
    let port = 3128;

    let (_tx_proxy, rx_proxy) = oneshot::channel::<()>();
    let (_tx_pac, rx_pac) = oneshot::channel::<()>();
    let (tx_proxy_log, _rx_proxy_log) = tokio::sync::mpsc::channel::<Vec<u8>>(32);

    pac_server::serve_pac_file("proxy.pac".to_string(), 8000, rx_pac).await.unwrap();
    proxy_server::serve_proxy(proxy_address.to_string(), port, rx_proxy, tx_proxy_log).await.unwrap();

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