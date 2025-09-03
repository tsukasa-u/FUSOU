use proxy_https::bidirectional_channel;
use regex::Regex;
use register_trait::expand_struct_selector;
use register_trait::TraitForConvert;
use std::error::Error;
use tauri::Emitter;

use crate::auth::{auth_server, supabase};
use crate::database::table::{GetDataTable, PortTable};
use crate::util::get_user_env_id;
use kc_api::interface::cells::Cells;

use crate::cloud_storage::google_drive;
use kc_api::interface::interface::{Add, EmitData, Identifier, Set};

pub fn emit_data(handle: &tauri::AppHandle, emit_data: EmitData) {
    match emit_data {
        EmitData::Add(data) => match data {
            Add::Materials(data) => {
                let _ = handle.emit_to("main", "add-kcs-materials", data);
            }
            Add::Ships(data) => {
                data.add_or();
                let _ = handle.emit_to("main", "add-kcs-ships", data);
            }
            Add::Battle(data) => {
                data.add_or();
                let _ = handle.emit_to("main", "add-kcs-battle", data);
            }
            Add::Cell(data) => {
                data.add_or();
                let _ = handle.emit_to("main", "add-kcs-cell", data);
            }
            Add::Dammy(_) => {
                let _ = handle.emit_to("main", "add-kcs-dammy", ());
            }
        },
        EmitData::Set(data) => match data {
            Set::DeckPorts(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-deck-ports", data);
            }
            Set::Materials(data) => {
                let _ = handle.emit_to("main", "set-kcs-materials", data);
            }
            Set::Ships(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-ships", data);
            }
            Set::SlotItems(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-slot-items", data);
            }
            Set::NDocks(data) => {
                let _ = handle.emit_to("main", "set-kcs-n-docks", data);
            }
            Set::Logs(data) => {
                let _ = handle.emit_to("main", "set-kcs-logs", data);
            }
            Set::AirBases(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-air-bases", data);
            }
            Set::MstShips(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-ships", data);
            }
            Set::MstSlotItems(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-slot-items", data);
            }
            Set::MstEquipExslotShips(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-equip-exslot-ships", data);
            }
            Set::MstEquipShips(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-equip-ships", data);
            }
            Set::MstStypes(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-stypes", data);
            }
            Set::MstUseItems(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-use-items", data);
            }
            Set::MstSlotItemEquipTypes(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-slot-item-equip-types", data);
            }
            Set::Cells(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-cells", data);
            }
            Set::MstMapAreas(data) => {
                data.restore();
            }
            Set::MstMapInfos(data) => {
                data.restore();
            }
            Set::MstShipGraphs(data) => {
                data.restore();
            }
            Set::MstShipUpgrades(data) => {
                data.restore();
            }
            Set::MstEquipExslots(data) => {
                data.restore();
            }
            Set::MstEquipLimitExslots(data) => {
                data.restore();
            }
            Set::Dammy(_) => {
                let _ = handle.emit_to("main", "set-kcs-dammy", ());
            }
        },
        EmitData::Identifier(data) => match data {
            Identifier::Port(_) => {
                if Cells::reset_flag() {
                    let cells = Cells::load();
                    tokio::task::spawn(async move {
                        let user_env = get_user_env_id().await;
                        let timestamp = chrono::Utc::now().timestamp();
                        let port_table = PortTable::new(cells, user_env, timestamp);
                        Cells::reset();
                        match port_table.encode() {
                            Ok(port_table_encode) => {
                                let pariod_tag = supabase::get_period_tag().await;
                                let hub = google_drive::create_client().await;
                                match hub {
                                    Some(mut hub) => {
                                        let folder_name =
                                            vec!["fusou".to_string(), pariod_tag.clone()];
                                        let folder_id =
                                            google_drive::check_or_create_folder_hierarchical(
                                                &mut hub,
                                                folder_name,
                                                Some("root".to_string()),
                                            )
                                            .await;

                                        let result = google_drive::write_port_table(
                                            &mut hub,
                                            folder_id,
                                            port_table_encode,
                                        )
                                        .await;
                                        if result.is_none() {
                                            println!(
                                                "\x1b[38;5;{}m Failed to write port table\x1b[m ",
                                                8
                                            );
                                        }
                                    }
                                    None => {
                                        println!(
                                            "\x1b[38;5;{}m Failed to create google drive client\x1b[m ",
                                            8
                                        );
                                        let _ = auth_server::open_auth_page();
                                    }
                                };
                            }
                            Err(e) => {
                                println!(
                                    "\x1b[38;5;{}m Failed to encode port table: {}\x1b[m ",
                                    8, e
                                );
                            }
                        }
                    });
                }
            }
            Identifier::RequireInfo(_) => {}
            Identifier::GetData(_) => {
                let get_data_table = GetDataTable::new();
                tokio::task::spawn(async move {
                    match get_data_table.encode() {
                        Ok(get_data_table_encode) => {
                            let pariod_tag = supabase::get_period_tag().await;
                            let hub = google_drive::create_client().await;
                            match hub {
                                Some(mut hub) => {
                                    let folder_name = vec!["fusou".to_string(), pariod_tag.clone()];
                                    let folder_id =
                                        google_drive::check_or_create_folder_hierarchical(
                                            &mut hub,
                                            folder_name,
                                            Some("root".to_string()),
                                        )
                                        .await;

                                    let result = google_drive::write_get_data_table(
                                        &mut hub,
                                        folder_id,
                                        get_data_table_encode,
                                    )
                                    .await;
                                    if result.is_none() {
                                        println!(
                                            "\x1b[38;5;{}m Failed to write get data table\x1b[m ",
                                            8
                                        );
                                    }
                                }
                                None => {
                                    println!(
                                        "\x1b[38;5;{}m Failed to create google drive client\x1b[m ",
                                        8
                                    );
                                }
                            };
                        }
                        Err(e) => {
                            println!(
                                "\x1b[38;5;{}m Failed to encode get data table: {}\x1b[m ",
                                8, e
                            );
                        }
                    }
                });
            }
        },
    }
}

// Should I rewrite this attribute marcro to macro_rules!?
#[expand_struct_selector(path = "./../../kc_api/src/kcapi_main")]
pub fn struct_selector_response(
    name: String,
    data: String,
) -> Result<Vec<EmitData>, Box<dyn Error>> {
    let data_removed_bom: String = data.replace("\u{feff}", "");
    let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");

    #[cfg(dev)]
    let re_metadata = Regex::new(r"---\r?\n.*\r?\n.*\r?\n.*\r?\n.*\s*---\r?\n").unwrap();

    #[cfg(dev)]
    let data_removed_metadata: String = re_metadata.replace(&data_removed_svdata, "").to_string();

    #[cfg(dev)]
    let root_wrap: Result<kcsapi_lib::Res, serde_json::Error> =
        serde_json::from_str(&data_removed_metadata);
    #[cfg(any(not(dev), check_release))]
    let root_wrap: Result<kcsapi_lib::Res, serde_json::Error> =
        serde_json::from_str(&data_removed_svdata);

    match root_wrap {
        Ok(root) => match root.convert() {
            Some(emit_data_list) => {
                return Ok(emit_data_list);
            }
            None => {
                return Ok(Vec::new());
            }
        },
        Err(e) => {
            println!(
                "\x1b[38;5;{}m Failed to parse Res JSON({:?}): {}\x1b[m ",
                8, name, e
            );
            return Err(Box::new(e));
        }
    };
}

// Should I rewrite this attribute marcro to macro_rules!?
#[expand_struct_selector(path = "./../../kc_api/src/kcapi_main")]
pub fn struct_selector_resquest(
    name: String,
    data: String,
) -> Result<Vec<EmitData>, Box<dyn Error>> {
    let data_removed_bom: String = data.replace("\u{feff}", "");

    #[cfg(dev)]
    let re_metadata = Regex::new(r"---\r?\n.*\r?\n.*\r?\n.*\r?\n.*\s*---\r?\n").unwrap();

    #[cfg(dev)]
    let data_removed_metadata: String = re_metadata.replace(&data_removed_bom, "").to_string();

    #[cfg(dev)]
    let root_wrap: Result<kcsapi_lib::Req, serde_qs::Error> =
        serde_qs::from_str(&data_removed_metadata);
    #[cfg(any(not(dev), check_release))]
    let root_wrap: Result<kcsapi_lib::Req, serde_qs::Error> = serde_qs::from_str(&data_removed_bom);

    match root_wrap {
        Ok(root) => match root.convert() {
            Some(emit_data_list) => {
                return Ok(emit_data_list);
            }
            None => {
                return Ok(Vec::new());
            }
        },
        Err(e) => {
            println!(
                "\x1b[38;5;{}m Failed to parse Req JSON({:?}): {}\x1b[m ",
                8, name, e
            );
            return Err(Box::new(e));
        }
    };
}

async fn response_parser(
    handle: &tauri::AppHandle,
    mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    mut proxy_log_slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) {
    loop {
        tokio::select! {
            recv_log = proxy_log_slave.recv() => {
                match recv_log {
                    None => {
                        println!("Received None message");
                    },
                    Some(bidirectional_channel::StatusInfo::RESPONSE { path, content_type: _, content }) => {
                        let handle_clone = handle.clone();
                        tokio::task::spawn(async move {
                            if let Ok(emit_data_list) = struct_selector_response(path, content) {
                                for emit_data_element in emit_data_list {
                                    emit_data(&handle_clone, emit_data_element);
                                }
                            };
                        });
                    },
                    Some(bidirectional_channel::StatusInfo::REQUEST { path, content_type: _, content }) => {
                        let handle_clone = handle.clone();
                        tokio::task::spawn(async move {
                            if let Ok(emit_data_list) = struct_selector_resquest(path, content) {
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
                        println!("Received shutdown message: {status} {message}");
                        let _ = slave.send(bidirectional_channel::StatusInfo::SHUTDOWN {
                            status: "SHUTTING DOWN".to_string(),
                            message: "Response parser is shutting down".to_string(),
                        }).await;
                        break;
                    },
                    Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                        println!("Received health message: {status} {message}");
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

pub fn serve_reponse_parser(
    handle: &tauri::AppHandle,
    slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    proxy_log_slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) {
    let handle_clone = handle.clone();
    tokio::task::spawn(async move { response_parser(&handle_clone, slave, proxy_log_slave).await });
}
