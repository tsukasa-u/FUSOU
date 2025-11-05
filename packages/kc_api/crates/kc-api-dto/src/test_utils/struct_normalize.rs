#![cfg(test)]

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

fn normalize_for_mask_seacret(val: Value) -> Value {
    match val {
        Value::Number(n) => Value::Number(n),

        Value::String(s) => {
            if s.eq("api_token") {
                Value::String("[API_TOKEN]".to_string())
            } else {
                Value::String(s)
            }
        }

        Value::Array(arr) => {
            let normalized_arr = arr.into_iter().map(normalize_for_mask_seacret).collect();
            Value::Array(normalized_arr)
        }

        Value::Object(map) => {
            let normalized_map = map
                .into_iter()
                .map(|(k, v)| (k, normalize_for_mask_seacret(v)))
                .collect();
            Value::Object(normalized_map)
        }

        _ => val,
    }
}

fn keep_test_data(
    val: Value,
    file_name: String,
    snap_file_path: String,
    timestamp: String,
    format_type: FormatType,
) {
    let val_masked = normalize_for_mask_seacret(val);
    let serialized = match format_type {
        FormatType::Json => serde_json::to_string_pretty(&val_masked).unwrap(),
        FormatType::QueryString => serde_qs::to_string(&val_masked).unwrap(),
    };

    let mut file_name_formatted = file_name;

    file_name_formatted = file_name_formatted
        .split_once("@")
        .map(|(prefix, suffix)| {
            let last_char = prefix
                .chars()
                .last()
                .map(|c| c.to_string())
                .unwrap_or_default();
            format!("{timestamp}{last_char}@{suffix}")
        })
        .expect("can not get 1th of file name splitted with '@'");

    if !file_name_formatted.ends_with(".json") {
        file_name_formatted = format!("{file_name_formatted}.json");
    }
    file_name_formatted = format!(
        "{}/{}",
        snap_file_path.trim_end_matches("/"),
        file_name_formatted
    );

    let mut file = std::fs::File::create(file_name_formatted).expect("can not create file");
    writeln!(file, "{serialized}").expect("can not write.");
}

fn normalize_for_test(val: Value) -> Value {
    match val {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                if i > 0 {
                    Value::String("[POS_INT]".to_string())
                } else if i < 0 {
                    Value::String("[NEG_INT]".to_string())
                } else {
                    Value::String("[ZERO_INT]".to_string())
                }
            } else if let Some(f) = n.as_f64() {
                if f > 0.0 {
                    Value::String("[POS_FLOAT]".to_string())
                } else if f < 0.0 {
                    Value::String("[NEG_FLOAT]".to_string())
                } else {
                    Value::String("[ZERO_FLOAT]".to_string())
                }
            } else {
                // fallback: keep the original number if none of the checks matched
                Value::Number(n)
            }
        }

        Value::String(s) => {
            // if s.starts_with("user_") {
            //     Value::String("[USER_ID]".to_string())
            // } else {
            //     Value::String(s)
            // }
            Value::String(s)
        }

        Value::Array(arr) => {
            let normalized_arr = arr.into_iter().map(normalize_for_test).collect();
            Value::Array(normalized_arr)
        }

        Value::Object(map) => {
            let normalized_map = map
                .into_iter()
                .map(|(k, v)| (k, normalize_for_test(v)))
                .collect();
            Value::Object(normalized_map)
        }

        _ => val,
    }
}

pub fn test_match_normalize(expected: Value, snap_values: Vec<Value>) -> bool {
    let normalized_expected = normalize_for_test(expected.clone());
    let normalized_snap = snap_values
        .into_iter()
        .map(normalize_for_test)
        .collect::<Vec<_>>();

    let result_eq = normalized_snap
        .iter()
        .zip(std::iter::repeat(&normalized_expected))
        .any(|(a, b)| a == b);

    result_eq
}

pub fn custom_match_normalize<T>(
    test_data_paths: impl Iterator<Item = PathBuf>,
    pattern_str: String,
    snap_file_path: String,
    format_type: FormatType,
) where
    T: serde::de::DeserializeOwned + serde::Serialize + std::fmt::Debug,
{
    let snap_file_path = path::PathBuf::from(snap_file_path);
    let snap_files = snap_file_path
        .read_dir()
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let snap_file_list = snap_files
        .map(|dir_entry| dir_entry.unwrap().path())
        .filter(|file_path| file_path.to_str().unwrap().ends_with(&pattern_str))
        .collect::<Vec<_>>();
    let mut snap_values: Vec<Value> = snap_file_list
        .iter()
        .map(|snap_file_path| {
            let file_content = std::fs::read_to_string(snap_file_path).unwrap_or_else(|_| {
                panic!("failed to read snap file: {}", snap_file_path.display())
            });
            let data_removed_metadata = remove_metadata(file_content);
            let parsed: T = match format_type.clone() {
                FormatType::Json => {
                    let parsed: T =
                        serde_json::from_str(&data_removed_metadata).unwrap_or_else(|_| {
                            panic!(
                                "failed to parse snap file as JSON: {}",
                                snap_file_path.display()
                            )
                        });
                    parsed
                }
                FormatType::QueryString => {
                    let parsed: T =
                        serde_qs::from_str(&data_removed_metadata).unwrap_or_else(|_| {
                            panic!(
                                "failed to parse snap file as query string: {}",
                                snap_file_path.display()
                            )
                        });
                    parsed
                }
            };
            serde_json::to_value(&parsed).unwrap_or_else(|_| {
                panic!(
                    "failed to convert snap data to Value: {}",
                    snap_file_path.display()
                )
            })
        })
        .collect();

    let regex_timestamp = regex::Regex::new(r#"Timestamp: ([0-9]+)"#).unwrap();
    for test_data_path in test_data_paths {
        let file_content = std::fs::read_to_string(test_data_path.clone()).unwrap_or_else(|_| {
            panic!(
                "failed to read test data file: {}",
                test_data_path.display()
            )
        });
        let data_removed_metadata = remove_metadata(file_content.clone());
        let test_data: T = serde_json::from_str(&data_removed_metadata).unwrap_or_else(|_| {
            panic!(
                "failed to parse test data file as JSON: {}",
                test_data_path.display()
            )
        });

        let expected_value: Value = serde_json::to_value(&test_data).unwrap_or_else(|_| {
            panic!(
                "failed to convert test data to Value: {}",
                test_data_path.display()
            )
        });

        let timestamp = file_content
            .lines()
            .find_map(|line| {
                regex_timestamp
                    .captures(line)
                    .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
            })
            .expect("failed to get timestamp in test data");

        let keep_value = expected_value.clone();
        if !test_match_normalize(expected_value.clone(), snap_values.clone()) {
            println!(
                "\x1b[38;5;{}m unmatched snapshot, add test data {} to snap file path {}\x1b[m ",
                13,
                test_data_path.display(),
                snap_file_path.display()
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
            keep_test_data(
                keep_value,
                test_file_name,
                snap_file_path.to_string_lossy().to_string(),
                timestamp,
                format_type.clone(),
            );
            snap_values.push(expected_value.clone());
        }
    }
}

pub fn glob_match_normalize<T>(
    test_data_path: String,
    pattern_str: String,
    snap_file_path: String,
    format_type: FormatType,
) where
    T: serde::de::DeserializeOwned + serde::Serialize + std::fmt::Debug,
{
    let target = path::PathBuf::from(test_data_path);
    let target_files = target
        .read_dir()
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let target_file_list = target_files
        .map(|dir_entry| dir_entry.unwrap().path())
        .filter(|file_path| file_path.to_str().unwrap().ends_with(&pattern_str))
        .collect::<Vec<_>>();

    custom_match_normalize::<T>(
        target_file_list.into_iter(),
        pattern_str,
        snap_file_path,
        format_type,
    );
}
