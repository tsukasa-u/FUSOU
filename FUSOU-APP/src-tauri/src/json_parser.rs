use std::error::Error;
use proxy::bidirectional_channel;
use register_trait::TraitForConvert;

use register_trait::expand_struct_selector;

// use crate::kcapi;
use crate::interface::interface::{EmitData, Add, Set};

fn emit_data<R: tauri::Runtime>(handle: &impl tauri::Manager<R>, emit_data: EmitData) {
    match emit_data {
        EmitData::Add(data) => {
            match data {
                Add::DeckPorts(data) => {
                    // println!("DeckPorts: {:?}", data);
                    let _ = handle.emit_to("main", "add-kcs-deck-ports", data);
                },
                Add::Materials(data) => {
                    // println!("Materials: {:?}", data.clone());
                    let _ = handle.emit_to("main", "add-kcs-materials", data);
                },
                Add::Ships(data) => {
                    // println!("Ships: {:?}", data);
                    let _ = handle.emit_to("main", "add-kcs-ships", data);
                },
                Add::NDocks(data) => {
                    // println!("NDocks: {:?}", data);
                    let _ = handle.emit_to("main", "add-kcs-n-docks", data);
                },
                Add::Logs(data) => {
                    // println!("Logs: {:?}", data);
                    let _ = handle.emit_to("main", "add-kcs-logs", data);
                },
                Add::MstShips(data) => {
                    // println!("MstShips: {:?}", data);
                    let _ = handle.emit_to("main", "add-kcs-mst-ships", data);
                },
            }
        },
        EmitData::Set(data) => {
            match data {
                Set::DeckPorts(data) => {
                    // println!("DeckPorts: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-deck-ports", data);
                },
                Set::Materials(data) => {
                    // println!("Materials: {:?}", data.clone());
                    let _ = handle.emit_to("main", "set-kcs-materials", data);
                },
                Set::Ships(data) => {
                    // println!("Ships: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-ships", data);
                },
                Set::NDocks(data) => {
                    // println!("NDocks: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-n-docks", data);
                },
                Set::Logs(data) => {
                    // println!("Logs: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-logs", data);
                },
                Set::MstShips(data) => {
                    // println!("MstShips: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-mst-ships", data);
                },
            }
        },
    }
}

// Should I rewrite this attribute marcro to macro_rules!?
#[expand_struct_selector(path = "./src/kcapi/")]
fn struct_selector(name: String, data: String) -> Result<Vec<EmitData>,  Box<dyn Error>> {
    
    let data_removed_bom: String = data.replace("\u{feff}", "");
    let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");
    let root_wrap: Result<kcsapi_lib::Root, serde_json::Error> = serde_json::from_str(&data_removed_svdata);
    match root_wrap {
        Ok(root) => {
            match root.convert() {
                Some(emit_data_list) => {
                    return Ok(emit_data_list);
                },
                None => {
                    return Ok(Vec::new());
                }
            }
        },
        Err(e) => {
            println!("\x1b[38;5;{}m Failed to parse JSON({:?}): {}\x1b[m ", 8, name, e);
            return Err(Box::new(e));
        }
    };
}

async fn response_parser<R: tauri::Runtime>(handle: &impl tauri::Manager<R>, mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>, mut proxy_log_slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>) {
    
    loop {
        tokio::select! {
            recv_log = proxy_log_slave.recv() => {
                match recv_log {
                    None => {
                        println!("Received None message");
                    },
                    Some(bidirectional_channel::StatusInfo::CONTENT { path, content_type, content }) => {
                        let handle_clone = handle.app_handle();
                        tokio::task::spawn(async move {
                            if let Ok(emit_data_list) = struct_selector(path, content) {
                                for emit_data_element in emit_data_list {
                                    emit_data(&handle_clone, emit_data_element);
                                }
                            };
                        });
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
    println!("Shutting Response parser");
}

pub fn serve_reponse_parser<R: tauri::Runtime>(handle: &impl tauri::Manager<R>, slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>, proxy_log_slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>) {

    let handle_clone = handle.app_handle();
    tokio::task::spawn(async move {
        response_parser(&handle_clone, slave, proxy_log_slave).await
    });
}