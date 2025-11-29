use chrono::DateTime;
use kc_api_database::table::{GetDataTable, PortTable};
use kc_api_interface::{
    cells::Cells,
    interface::{Add, EmitData, Identifier, Set},
};
use kc_api_parser::parser;
use std::{fs, path::PathBuf};
use uuid::Uuid;

use register_trait::{check::write_log_check_field_size, FieldSizeChecker};

use dotenvy::dotenv;

enum ReturnType {
    PortTable(PortTable),
    GetDataTable(GetDataTable),
}

fn emit_data(emit_data: EmitData) -> Option<ReturnType> {
    match emit_data {
        EmitData::Add(data) => match data {
            Add::Materials(_) => {}
            Add::Ships(data) => {
                data.add_or();
            }
            Add::Battle(data) => {
                data.add_or();
            }
            Add::Cell(data) => {
                data.add_or();
            }
            Add::Dammy(_) => {}
        },
        EmitData::Set(data) => match data {
            Set::DeckPorts(data) => {
                data.restore();
            }
            Set::Materials(_) => {}
            Set::UseItems(data) => {
                data.restore();
            }
            Set::Ships(data) => {
                data.restore();
            }
            Set::SlotItems(data) => {
                data.restore();
            }
            Set::NDocks(_) => {}
            Set::Logs(_) => {}
            Set::AirBases(data) => {
                data.restore();
            }
            Set::MstShips(data) => {
                data.restore();
            }
            Set::MstSlotItems(data) => {
                data.restore();
            }
            Set::MstEquipExslotShips(data) => {
                data.restore();
            }
            Set::MstEquipShips(data) => {
                data.restore();
            }
            Set::MstStypes(data) => {
                data.restore();
            }
            Set::MstUseItems(data) => {
                data.restore();
            }
            Set::MstSlotItemEquipTypes(data) => {
                data.restore();
            }
            Set::Cells(data) => {
                data.restore();
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
            Set::Dammy(_) => {}
        },
        EmitData::Identifier(data) => match data {
            Identifier::Port(_) => {
                let cells = Cells::load();
                // 123e4567-e89b-12d3-a456-42661417400
                let user_env = Uuid::from_fields(
                    0x123e4567_u32,
                    0xe89b_u16,
                    0x12d3_u16,
                    &[
                        0x42_u8, 0x66_u8, 0x42_u8, 0x66_u8, 0x14_u8, 0x17_u8, 0x40_u8, 0x00_u8,
                    ],
                )
                .to_string();
                let timestamp = DateTime::parse_from_rfc3339("1970-01-01T00:00:01Z")
                    .expect("failed to parse rfc3339")
                    .timestamp();
                let port_table = PortTable::new(cells, user_env, timestamp);
                return Some(ReturnType::PortTable(port_table));
            }
            Identifier::RequireInfo(_) => {}
            Identifier::GetData(_) => {
                let get_data_table = GetDataTable::new();
                return Some(ReturnType::GetDataTable(get_data_table));
            }
            Identifier::MapStart(_) => {}
        },
    }
    None
}


fn get_timestamp_from_file_content(file_path: PathBuf) -> String {
    let regex_timestamp = regex::Regex::new(r#"Timestamp: ([0-9]+)"#).unwrap();
    let file_content = std::fs::read_to_string(file_path.clone())
        .unwrap_or_else(|_| panic!("failed to read test data file: {}", file_path.display()));
    let timestamp = file_content
        .lines()
        .find_map(|line| {
            regex_timestamp
                .captures(line)
                .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        })
        .unwrap_or({
            let (prefix, _) = file_path
                .file_name()
                .unwrap_or_else(|| panic!("failed to get file name: {}", file_path.display()))
                .to_str()
                .unwrap_or_else(|| {
                    panic!(
                        "failed to convert file name to str: {}",
                        file_path.display()
                    )
                })
                .split_once("@")
                .unwrap_or_else(|| panic!("failed to split file name: {}", file_path.display()));
            let splited_under = match prefix.split_once("_") {
                Some((_, suffix)) => suffix.to_string(),
                None => prefix.to_string(),
            };

            if splited_under.ends_with('S') || splited_under.ends_with('Q') {
                splited_under[..splited_under.len() - 1].to_string()
            } else {
                panic!(
                    "failed to get timestamp from file name: {}",
                    file_path.display()
                )
            }
        });
    timestamp
}

pub fn check_database_field_size() {
    use regex::Regex;

    dotenv().expect(".env file not found");
    let target_path = std::env::var("TEST_DATA_PATH").expect("failed to get env data");

    let target = PathBuf::from(target_path);
    let files = target
        .read_dir()
        .expect("read_dir call failed")
        .collect::<Vec<_>>();

    let mut file_api_seq_vec: Vec<Vec<PathBuf>> = Vec::new();
    for dir_entry in files {
        let file_path = dir_entry.unwrap().path();
        let file_name = file_path
            .file_name()
            .expect("failed to get file name")
            .to_str()
            .expect("failed to convert to str");
        if file_name.ends_with("Q@api_start2@get_option_setting") {
            file_api_seq_vec.push(vec![file_path]);
        } else if !file_api_seq_vec.is_empty() {
            file_api_seq_vec.last_mut().unwrap().push(file_path);
        } else {
            continue;
        }
    }

    let re_metadata = Regex::new(r"---\r?\n.*\r?\n.*\r?\n.*\r?\n.*\s*---\r?\n").unwrap();

    let mut log_map_port_table: register_trait::LogMapNumberSize = std::collections::HashMap::new();
    let mut log_map_get_data_table: register_trait::LogMapNumberSize =
        std::collections::HashMap::new();

    for file_api_seq in file_api_seq_vec {
        let skip_flag = file_api_seq
            .iter()
            .filter(|file_path| {
                let file_name = file_path
                    .file_name()
                    .expect("failed to get file name")
                    .to_str()
                    .expect("failed to convert to str");
                file_name.contains("@api_start2@getData")
            })
            .any(|file_path| {
                let ts_int = get_timestamp_from_file_content(file_path.clone()).parse::<i64>() .expect("failed to get timestamp from file_ contnet");
                #[cfg(feature = "from20250627")]
                {
                    !(ts_int >= 1750993200)
                }
                #[cfg(not(feature = "from20250627"))]
                {
                    !(ts_int < 1750993200)
                }
            });
        if skip_flag {
            continue;
        }
            
        for file_path in file_api_seq {
            let file_content = fs::read_to_string(file_path.clone())
                .unwrap_or_else(|_| panic!("can not read the file({})", file_path.display()));

            let data_removed_bom: String = file_content.replace("\u{feff}", "");
            let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");
            let data_removed_metadata: String =
                re_metadata.replace(&data_removed_svdata, "").to_string();

            let parse_path = file_path
                .file_name()
                .expect("failed to get file name")
                .to_str()
                .expect("failed to convert to str")
                .split("@")
                .collect::<Vec<&str>>();
            if parse_path.len() < 3 {
                panic!(
                    "file name format is invalid({}): {:?}",
                    file_path.display(),
                    parse_path
                );
            }
            let path_name = format!("/kcsapi/{}/{}", parse_path[1], parse_path[2]);

            let emit_data_list = match parse_path[0] {
                s if s.ends_with("S") => {
                    let emit_data_list: Vec<EmitData> =
                        parser::response_parser(path_name, data_removed_metadata).unwrap_or_else(
                            |e| panic!("failed to parse the file({}), e: {e}", file_path.display()),
                        );
                    emit_data_list
                }
                s if s.ends_with("Q") => {
                    let encoded_data = data_removed_metadata
                        .replace("%5B", "[")
                        .replace("%5D", "]");
                    let emit_data_list: Vec<EmitData> =
                        parser::request_parser(path_name, encoded_data).unwrap_or_else(
                            |e| panic!("failed to parse the file({}), e: {e}", file_path.display()),
                        );
                    emit_data_list
                }
                _ => {
                    panic!("file name format is invalid({})", file_path.display());
                }
            };

            for data in emit_data_list {
                match emit_data(data) {
                    Some(ReturnType::PortTable(port_table)) => {
                        port_table.check_number(&mut log_map_port_table, None);
                    }
                    Some(ReturnType::GetDataTable(get_data_table)) => {
                        get_data_table.check_number(&mut log_map_get_data_table, None);
                    }
                    None => { /* do nothing */ }
                }
            }
        }
    }

    write_log_check_field_size(
        "./tests/check_database_field_size@port_table.log".to_string(),
        &log_map_port_table,
    );
    write_log_check_field_size(
        "./tests/check_database_field_size@get_data_table.log".to_string(),
        &log_map_get_data_table,
    );
}
