#![cfg(test)]

use core::panic;
use std::path::{self, PathBuf};

use serde_json::Value;
use serde_qs;
use std::io::Write;

#[derive(Clone)]
pub enum FormatType {
    Json,
    QueryString,
}

fn remove_metadata(data: String) -> String {
    let re_metadata = regex::Regex::new(r"---\r?\n.*\r?\n.*\r?\n.*\r?\n.*\s*---\r?\n").unwrap();
    let data_removed_bom: String = data.replace("\u{feff}", "");
    let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");
    let data_removed_metadata: String = re_metadata.replace(&data_removed_svdata, "").to_string();
    data_removed_metadata
}

fn normalize_for_mask_seacret(key: String, val: Value) -> Value {
    match val {
        Value::Number(n) => Value::Number(n),

        Value::String(s) => {
            if key.eq("api_token") {
                Value::String("__API_TOKEN__".to_string())
            } else if s.ends_with("\n") {
                Value::String(s.replace("\n", ""))
            } else {
                Value::String(s)
            }
        }

        Value::Array(arr) => {
            let normalized_arr = arr
                .into_iter()
                .map(|v| normalize_for_mask_seacret(key.clone(), v))
                .collect();
            Value::Array(normalized_arr)
        }

        Value::Object(map) => {
            let normalized_map = map
                .into_iter()
                .map(|(k, v)| (k.clone(), normalize_for_mask_seacret(k, v)))
                .collect();
            Value::Object(normalized_map)
        }

        _ => val,
    }
}

fn keep_test_data(
    val: Value,
    another_val: Value,
    file_name: String,
    snap_file_path: String,
    timestamp: String,
    format_type: FormatType,
) {
    let val_masked = normalize_for_mask_seacret("root".to_string(), val);
    let serialized = match format_type {
        FormatType::Json => serde_json::to_string_pretty(&val_masked).unwrap(),
        FormatType::QueryString => serde_qs::to_string(&val_masked).unwrap(),
    };
    let another_val_masked = normalize_for_mask_seacret("root".to_string(), another_val);
    let another_serialized = match format_type {
        FormatType::QueryString => serde_json::to_string_pretty(&another_val_masked).unwrap(),
        FormatType::Json => serde_qs::to_string(&another_val_masked).unwrap(),
    };

    let file_name_formatted = file_name
        .split_once("@")
        .map(|(_prefix, suffix)| format!("{timestamp}#@{suffix}"))
        .expect("can not get 1th of file name splitted with '@'");

    let req_file_name_formatted = {
        let formatted = file_name_formatted
            .split_once("#")
            .map(|(prefix, suffix)| format!("{prefix}Q{suffix}"))
            .unwrap_or(file_name_formatted.clone());
        format!("{}/{}", snap_file_path.trim_end_matches("/"), formatted)
    };
    let res_file_name_formatted = {
        let formatted = file_name_formatted
            .split_once("#")
            .map(|(prefix, suffix)| format!("{prefix}S{suffix}"))
            .unwrap_or(file_name_formatted.clone());
        format!("{}/{}", snap_file_path.trim_end_matches("/"), formatted)
    };

    let mut req_file = std::fs::File::create(req_file_name_formatted).expect("can not create file");
    match format_type {
        FormatType::Json => writeln!(req_file, "{another_serialized}").expect("can not write."),
        FormatType::QueryString => writeln!(req_file, "{serialized}").expect("can not write."),
    }
    let mut res_file = std::fs::File::create(res_file_name_formatted).expect("can not create file");
    match format_type {
        FormatType::Json => writeln!(res_file, "{serialized}").expect("can not write."),
        FormatType::QueryString => {
            writeln!(res_file, "{another_serialized}").expect("can not write.")
        }
    }
    println!(
        "\x1b[38;5;{}m added test data to snap file path: {}\x1b[m ",
        10, snap_file_path
    );
}

fn normalize_for_test(key: String, val: Value) -> Value {
    match val {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                if i > 0 {
                    Value::String("__POS_INT__".to_string())
                } else if i < 0 {
                    Value::String("__NEG_INT__".to_string())
                } else {
                    Value::String("__ZERO_INT__".to_string())
                }
            } else if let Some(f) = n.as_f64() {
                if f > 0.0 {
                    Value::String("__POS_FLOAT__".to_string())
                } else if f < 0.0 {
                    Value::String("__NEG_FLOAT__".to_string())
                } else {
                    Value::String("__ZERO_FLOAT__".to_string())
                }
            } else {
                // fallback: keep the original number if none of the checks matched
                Value::Number(n)
            }
        }

        Value::String(s) => {
            if key.eq("api_token") {
                Value::String("__API_TOKEN__".to_string())
            } else if s.ends_with("\n") {
                Value::String(s.replace("\n", ""))
            } else {
                Value::String(s)
            }
        }

        Value::Array(arr) => {
            let normalized_arr = arr
                .into_iter()
                .map(|v| normalize_for_test(key.clone(), v))
                .collect();
            Value::Array(normalized_arr)
        }

        Value::Object(map) => {
            let normalized_map = map
                .into_iter()
                .map(|(k, v)| (k.clone(), normalize_for_test(k, v)))
                .collect();
            Value::Object(normalized_map)
        }

        _ => val,
    }
}

pub fn test_match_normalize(expected: Value, snap_values: Vec<Value>) -> bool {
    let normalized_expected = normalize_for_test("root".to_string(), expected.clone());
    let normalized_snap = snap_values
        .into_iter()
        .map(|v| normalize_for_test("root".to_string(), v))
        .collect::<Vec<_>>();

    let result_eq = normalized_snap
        .iter()
        .zip(std::iter::repeat(&normalized_expected))
        .any(|(a, b)| a == b);

    result_eq
}

fn convert_test_data_to_value<T, U>(file_content: String, format_type: FormatType) -> Value
where
    T: serde::de::DeserializeOwned + serde::Serialize,
    U: serde::de::DeserializeOwned + serde::Serialize,
{
    let data_removed_metadata = remove_metadata(file_content);
    let parsed: Value = match format_type {
        FormatType::Json => {
            let parsed: U = serde_json::from_str(&data_removed_metadata)
                .unwrap_or_else(|_| panic!("failed to parse test data file as JSON"));
            serde_json::to_value(&parsed)
                .unwrap_or_else(|_| panic!("failed to convert test data to Value"))
        }
        FormatType::QueryString => {
            let parsed: T = serde_qs::from_str(&data_removed_metadata)
                .unwrap_or_else(|_| panic!("failed to parse test data file as query string"));
            serde_json::to_value(&parsed)
                .unwrap_or_else(|_| panic!("failed to convert test data to Value"))
        }
    };
    parsed
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
        .unwrap_or("0".to_string());
    timestamp
}

fn convert_content_to_value<T, U>(file_path: PathBuf, format_type: FormatType) -> Value
where
    T: serde::de::DeserializeOwned + serde::Serialize,
    U: serde::de::DeserializeOwned + serde::Serialize,
{
    let file_content = std::fs::read_to_string(file_path.clone())
        .unwrap_or_else(|_| panic!("failed to read test data file: {}", file_path.display()));
    let data_removed_metadata = remove_metadata(file_content.clone());
    convert_test_data_to_value::<T, U>(data_removed_metadata, format_type)
}

pub fn custom_match_normalize<T, U>(
    test_data_paths: impl Iterator<Item = PathBuf>,
    another_test_data_paths: impl Iterator<Item = PathBuf>,
    snap_file_paths: impl Iterator<Item = PathBuf>,
    snap_file_directory_path: String,
    format_type: FormatType,
) where
    T: serde::de::DeserializeOwned + serde::Serialize,
    U: serde::de::DeserializeOwned + serde::Serialize,
{
    let mut snap_values: Vec<Value> = snap_file_paths
        .map(|snap_file_path| {
            convert_content_to_value::<T, U>(snap_file_path.clone(), format_type.clone())
        })
        .collect();

    let another_timestamp_map: std::collections::HashMap<i64, PathBuf> = another_test_data_paths
        .map(|path| {
            let timestamp = get_timestamp_from_file_content(path.clone());
            (timestamp.parse::<i64>().unwrap_or(0), path)
        })
        .collect();

    for test_data_path in test_data_paths {
        let expected_value: Value =
            convert_content_to_value::<T, U>(test_data_path.clone(), format_type.clone());

        let keep_value = expected_value.clone();
        if !test_match_normalize(expected_value.clone(), snap_values.clone()) {
            println!(
                "\x1b[38;5;{}m unmatched snapshot, tray to add test data {} to snap file path {}\x1b[m ",
                13,
                test_data_path.display(),
                snap_file_directory_path
            );

            let test_file_name = test_data_path
                .file_name()
                .unwrap_or_else(|| panic!("failed to get file name: {}", test_data_path.display()))
                .to_str()
                .unwrap_or_else(|| {
                    panic!(
                        "failed to convert file name to str: {}",
                        test_data_path.display()
                    )
                })
                .to_string();

            let timestamp = get_timestamp_from_file_content(test_data_path.clone());

            let another_test_data_path = {
                let ts_int = timestamp.parse::<i64>().unwrap_or(0);
                let value = match format_type {
                    FormatType::Json => another_timestamp_map
                        .keys()
                        .filter(|&&ts| ts <= ts_int && ts + 2000 >= ts_int)
                        .max_by_key(|&&ts| ts)
                        .map(|&ts| another_timestamp_map.get(&ts))
                        .unwrap_or_else(|| {
                            panic!("another test data file not found for timestamp: {timestamp}")
                        }),
                    FormatType::QueryString => another_timestamp_map
                        .keys()
                        .filter(|&&ts| ts >= ts_int && ts <= ts_int + 2000)
                        .min_by_key(|&&ts| ts)
                        .map(|&ts| another_timestamp_map.get(&ts))
                        .unwrap_or_else(|| {
                            panic!("another test data file not found for timestamp: {timestamp}")
                        }),
                };
                value.expect("failed to get another test data path").clone()
            };
            if !another_test_data_path.exists() {
                println!(
                    "\x1b[38;5;{}m another test data file not found: {}\x1b[m ",
                    9,
                    another_test_data_path.display()
                );
                continue;
            }
            let another_format_type = match format_type {
                FormatType::Json => FormatType::QueryString,
                FormatType::QueryString => FormatType::Json,
            };
            let another_expected_value: Value =
                convert_content_to_value::<T, U>(another_test_data_path, another_format_type);

            keep_test_data(
                keep_value,
                another_expected_value,
                test_file_name,
                snap_file_directory_path.clone(),
                timestamp,
                format_type.clone(),
            );
            snap_values.push(expected_value.clone());
        }
    }
}

pub fn glob_match_normalize_with_range<T, U>(
    test_data_path: String,
    pattern_str: String,
    snap_file_path: String,
    format_type: FormatType,
    range_start: Option<i64>,
    range_end: Option<i64>,
) where
    T: serde::de::DeserializeOwned + serde::Serialize,
    U: serde::de::DeserializeOwned + serde::Serialize,
{
    if range_end.is_none() && range_start.is_none() {
        panic!("either range_start or range_end must be Some value");
    }

    let target_pattern = match format_type {
        FormatType::Json => format!("S{pattern_str}"),
        FormatType::QueryString => format!("Q{pattern_str}"),
    };
    let another_target_pattern = match format_type {
        FormatType::Json => format!("Q{pattern_str}"),
        FormatType::QueryString => format!("S{pattern_str}"),
    };

    let target = path::PathBuf::from(test_data_path.clone());
    let target_files = target
        .read_dir()
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let target_file_list = target_files
        .map(|dir_entry| dir_entry.unwrap().path())
        .filter(|file_path| {
            file_path.to_str().unwrap().ends_with(&target_pattern) && {
                let timestamp = get_timestamp_from_file_content(file_path.clone())
                    .parse::<i64>()
                    .unwrap_or(0);
                match (range_start, range_end) {
                    (Some(start), Some(end)) => timestamp >= start && timestamp < end,
                    (Some(start), None) => timestamp >= start,
                    (None, Some(end)) => timestamp < end,
                    (None, None) => panic!("either range_start or range_end must be Some value"),
                }
            }
        })
        .collect::<Vec<_>>();

    let another_target = path::PathBuf::from(test_data_path.clone());
    let another_target_files = another_target
        .read_dir()
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let another_target_file_list = another_target_files
        .map(|dir_entry| dir_entry.unwrap().path())
        .filter(|file_path| {
            file_path
                .to_str()
                .unwrap()
                .ends_with(&another_target_pattern)
                && {
                    let timestamp = get_timestamp_from_file_content(file_path.clone())
                        .parse::<i64>()
                        .unwrap_or(0);
                    match (range_start, range_end) {
                        (Some(start), Some(end)) => timestamp >= start && timestamp < end,
                        (Some(start), None) => timestamp >= start,
                        (None, Some(end)) => timestamp < end,
                        (None, None) => {
                            panic!("either range_start or range_end must be Some value")
                        }
                    }
                }
        })
        .collect::<Vec<_>>();

    let snap_files = path::PathBuf::from(snap_file_path.clone())
        .read_dir()
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let snap_file_list = snap_files
        .map(|dir_entry| dir_entry.unwrap().path())
        .filter(|file_path| file_path.to_str().unwrap().ends_with(&target_pattern))
        .filter(|file_path| {
            file_path.to_str().unwrap().ends_with(&target_pattern) && {
                let timestamp = get_timestamp_from_file_content(file_path.clone())
                    .parse::<i64>()
                    .unwrap_or(0);
                match (range_start, range_end) {
                    (Some(start), Some(end)) => timestamp >= start && timestamp < end,
                    (Some(start), None) => timestamp >= start,
                    (None, Some(end)) => timestamp < end,
                    (None, None) => panic!("either range_start or range_end must be Some value"),
                }
            }
        })
        .collect::<Vec<_>>();

    custom_match_normalize::<T, U>(
        target_file_list.into_iter(),
        another_target_file_list.into_iter(),
        snap_file_list.into_iter(),
        snap_file_path,
        format_type,
    );
    println!(
        "\x1b[38;5;{}m completed test data normalization for pattern: {}\x1b[m ",
        10, pattern_str
    );
}

pub fn glob_match_normalize<T, U>(
    test_data_path: String,
    pattern_str: String,
    snap_file_path: String,
    format_type: FormatType,
) where
    T: serde::de::DeserializeOwned + serde::Serialize,
    U: serde::de::DeserializeOwned + serde::Serialize,
{
    let target_pattern = match format_type {
        FormatType::Json => format!("S{pattern_str}"),
        FormatType::QueryString => format!("Q{pattern_str}"),
    };
    let another_target_pattern = match format_type {
        FormatType::Json => format!("Q{pattern_str}"),
        FormatType::QueryString => format!("S{pattern_str}"),
    };

    let target = path::PathBuf::from(test_data_path.clone());
    let target_files = target
        .read_dir()
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let target_file_list = target_files
        .map(|dir_entry| dir_entry.unwrap().path())
        .filter(|file_path| file_path.to_str().unwrap().ends_with(&target_pattern))
        .collect::<Vec<_>>();

    let another_target = path::PathBuf::from(test_data_path.clone());
    let another_target_files = another_target
        .read_dir()
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let another_target_file_list = another_target_files
        .map(|dir_entry| dir_entry.unwrap().path())
        .filter(|file_path| {
            file_path
                .to_str()
                .unwrap()
                .ends_with(&another_target_pattern)
        })
        .collect::<Vec<_>>();

    let snap_files = path::PathBuf::from(snap_file_path.clone())
        .read_dir()
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let snap_file_list = snap_files
        .map(|dir_entry| dir_entry.unwrap().path())
        .filter(|file_path| file_path.to_str().unwrap().ends_with(&target_pattern))
        .collect::<Vec<_>>();

    custom_match_normalize::<T, U>(
        target_file_list.into_iter(),
        another_target_file_list.into_iter(),
        snap_file_list.into_iter(),
        snap_file_path,
        format_type,
    );
    println!(
        "\x1b[38;5;{}m completed test data normalization for pattern: {}\x1b[m ",
        10, pattern_str
    );
}
