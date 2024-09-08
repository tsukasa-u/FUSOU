use std::error::Error;
use proxy::bidirectional_channel;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::mpsc};
use serde_json::Value;

use register_macro_derive_and_attr::expand_struct_selector;
use register_trait::TraitForRoot;

// use crate::kcapi;
use crate::interface::interface::EmitData;

async fn emit_data(data: EmitData) {
    match data {
        EmitData::DeckPorts(data) => {
            println!("DeckPorts: {:?}", data);
        },
        EmitData::Materials(data) => {
            println!("Materials: {:?}", data);
        },
        EmitData::Ships(data) => {
            println!("Ships: {:?}", data);
        },
        EmitData::NDocks(data) => {
            println!("NDocks: {:?}", data);
        },
        EmitData::Logs(data) => {
            println!("Logs: {:?}", data);
        },
    }
}

// Should I rewrite this attribute marcro to macro_rules!?
#[expand_struct_selector(path = "./src/kcapi/")]
async fn struct_selector(name: String, message: String) -> Result<Vec<EmitData>,  Box<dyn Error>> {
    
    let root_wrap: Result<kcsapi_lib::Root, serde_json::Error> = serde_json::from_str(&message);
    match root_wrap {
        Ok(root) => {
            return Ok(root.convert::<EmitData>());
        },
        Err(e) => {
            println!("\x1b[38;5;{}m Failed to parse JSON({:?}): {}\x1b[m ", 8, name, e);
            return Err(Box::new(e));
        }
    };
}

async fn response_parser(mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>, mut proxy_log_slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>) {
    
    loop {
        tokio::select! {
            recv_log = proxy_log_slave.recv() => {
                match recv_log {
                    None => {
                        println!("Received None message");
                    },
                    Some(bidirectional_channel::StatusInfo::CONTENT { status, name, message }) => {
                        struct_selector(name, message).await;
                    },
                    _ => {}
                }
            },
            recv_msg = slave.recv() => {
                match recv_msg {
                    None => {
                        println!("Received None message");
                    },
                    Some(bidirectional_channel::StatusInfo::SHUTDOWN { status, message }) => {
                        println!("Received shutdown message: {} {}", status, message);
                        let _ = slave.send(bidirectional_channel::StatusInfo::SHUTDOWN {
                            status: "SHUTTING DOWN".to_string(),
                            message: "Response parser is shutting down".to_string(),
                        }).await;
                        break;
                    },
                    Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                        println!("Received health message: {} {}", status, message);
                        let _ = slave.send(bidirectional_channel::StatusInfo::HEALTH {
                            status: "RUNNING".to_string(),
                            message: "Response parser is running".to_string(),
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
}

fn serve_reponse_parser<R: tauri::Runtime>(handle: &impl tauri::Manager<R>, slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>, proxy_log_slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>) {
    let _ = handle;

    tokio::task::spawn(async move {
        response_parser(slave, proxy_log_slave)
    });
}