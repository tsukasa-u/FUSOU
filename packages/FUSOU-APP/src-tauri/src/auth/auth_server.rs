#[cfg(not(feature = "auth-local-server"))]
use configs;

#[cfg(feature = "auth-local-server")]
use std::{net::SocketAddr, sync::OnceLock};

#[cfg(feature = "auth-local-server")]
use warp::Filter;

#[cfg(feature = "auth-local-server")]
use proxy_https::bidirectional_channel::{self, Slave, StatusInfo};

#[cfg(feature = "auth-local-server")]
static AUTH_ADDR: OnceLock<SocketAddr> = OnceLock::new();

#[cfg(feature = "auth-local-server")]
pub struct AuthChannel {
    // pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

#[cfg(feature = "auth-local-server")]
pub fn serve_auth(
    port: u16,
    mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) -> SocketAddr {
    return *AUTH_ADDR.get_or_init(|| {

        let route_login = warp::path("login")
            .map(|| warp::http::Response::builder()
            .header("content-type", "text/html; charset=utf-8".to_string())
            .status(200)
            .body(include_str!("../../src/pages/vanilla/login.html").to_string()));
        let route_auth_callback = warp::path("auth_callback")
            .map(|| warp::http::Response::builder()
            .header("content-type", "text/html; charset=utf-8".to_string())
            .status(200)
            .body(include_str!("../../src/pages/vanilla/auth_callback.html")));
        let route_supabase = warp::path("supabase.js")
            .map(|| warp::http::Response::builder()
            .header("content-type", "text/javascript; charset=utf-8".to_string())
            .status(200)
            .body(include_str!("../../src/pages/vanilla/supabase.js")));
        let route_env = warp::path("env.js")
            .map(|| warp::http::Response::builder()
            .header("content-type", "text/javascript; charset=utf-8".to_string())
            .status(200)
            .body(include_str!("../../src/pages/vanilla/env.js")));
    
        let routes = route_login
            .or(route_auth_callback)
            .or(route_env)
            .or(route_supabase);
    
        let (addr, server_auth) = warp::serve(routes).bind_with_graceful_shutdown(([127, 0, 0, 1], port), async move {
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
                                    message: "Auth server is shutting down".to_string(),
                                }).await;
                                break;
                            },
                            Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                                println!("Received health message: {} {}", status, message);
                                let _ = slave.send(bidirectional_channel::StatusInfo::HEALTH {
                                    status: "RUNNING".to_string(),
                                    message: "Auth server is running".to_string(),
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
            tracing::info!("Shutting down Auth server");
        });
        println!("Auth server addr: {}", addr);
    
        tokio::task::spawn(server_auth);
    
        return addr;
    });
}

#[cfg(not(feature = "auth-local-server"))]
pub fn open_auth_page() -> Result<(), String> {
    // let result: Result<(), String> =
    //     webbrowser::open("http://localhost:4321/signinLocalApp").map_err(|e| e.to_string());

    if configs::get_user_configs_for_app().auth.get_deny_auth() {
        return Err("User authentication is denied".into());
    }

    let auth_page_url = configs::get_user_configs_for_app().auth.get_auth_page_url();
    let result = webbrowser::open(&auth_page_url).map_err(|e| e.to_string());
    return result;
}
