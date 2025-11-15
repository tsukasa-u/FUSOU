use crate::{LogMapType, TraitForRoot, TraitForTest};
use serde_json::Value;

use std::fs::File;
use std::io::Write;
use std::path;
use std::path::PathBuf;

// impl<T> TraitForTest for Vec<T> where T: TraitForTest {
//     fn is_vec(&self) -> bool { return true; }
// }

// impl<T> TraitForTest for Option<T> where T: TraitForTest {
//     fn is_option(&self) -> bool { return true; }
// }

// impl<T, U> TraitForTest for HashMap<T, U> where T: TraitForTest, U: TraitForTest {
//     fn is_hashmap(&self) -> bool { return true; }
// }

impl TraitForTest for Value {
    fn is_value(&self) -> bool {
        true
    }
}

macro_rules! register_trait {
    ($($type1:ty),*) => {$(impl TraitForTest for $type1 {})*};
}

register_trait!(
    i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize, f32, f64, bool, char, String
);

//-------------------------------------------------------------------------

fn write_log_test(log_path: String, log_map: &LogMapType) -> usize {
    let mut file = File::create(log_path)
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m can not create file\x1b[m ", 8));

    let local: chrono::DateTime<chrono::Local> = chrono::Local::now();
    writeln!(file, "test result [{local}]")
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
    writeln!(file, "test_name / struct_name / field_name / found types")
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));

    for ((test_name, struct_name, field_name), log) in log_map.iter() {
        writeln!(file, "{test_name} / {struct_name} / {field_name}: {log:#?}")
            .unwrap_or_else(|_| panic!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
    }
    log_map.len()
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

fn filter_range_start_end(
    file_path: PathBuf,
    range_start: Option<i64>,
    range_end: Option<i64>,
) -> bool {
    let ts_int = get_timestamp_from_file_content(file_path.clone())
        .parse::<i64>()
        .unwrap_or(0);
    if ts_int == 0 {
        return false;
    }
    match (range_start, range_end) {
        (Some(start), Some(end)) => ts_int >= start && ts_int < end,
        (Some(start), None) => ts_int >= start,
        (None, Some(end)) => ts_int < end,
        (None, None) => panic!("either range_start or range_end must be Some value"),
    }
}

pub fn simple_root_test_with_range<T>(
    target_path: String,
    pattren_str: String,
    log_path: String,
    range_start: Option<i64>,
    range_end: Option<i64>,
) where
    T: TraitForRoot,
{
    if range_end.is_none() && range_start.is_none() {
        panic!("either range_start or range_end must be Some value");
    }
    // let target_path = "./src/kc2api/test_data";
    let target = path::PathBuf::from(target_path);
    let files = target
        .read_dir()
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let file_list = files
        .map(|dir_entry| {
            // file_path.exists();
            dir_entry.unwrap().path()
        })
        .filter(|file_path| file_path.to_str().unwrap().ends_with(pattren_str.as_str()) && filter_range_start_end(file_path.clone(), range_start, range_end));

    custom_root_test::<T>(file_list, log_path);
}

pub fn simple_root_test<T>(target_path: String, pattren_str: String, log_path: String)
where
    T: TraitForRoot,
{
    // let target_path = "./src/kc2api/test_data";
    let target = path::PathBuf::from(target_path);
    let files = target
        .read_dir()
        .unwrap_or_else(|_| panic!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let file_list = files
        .map(|dir_entry| {
            // file_path.exists();
            dir_entry.unwrap().path()
        })
        .filter(|file_path| file_path.to_str().unwrap().ends_with(pattren_str.as_str()));

    custom_root_test::<T>(file_list, log_path);
}

pub fn custom_root_test<T>(file_list: impl Iterator<Item = PathBuf>, log_path: String)
where
    T: TraitForRoot,
{
    let log_map: LogMapType = T::test_deserialize(file_list);

    if write_log_test(log_path.clone(), &log_map) > 0 {
        if log_map
            .iter()
            .filter(|(key, log)| {
                (key.0 == "type_value" && log.iter().any(|x| x != "null")) || key.0 != "type_value"
            })
            .count()
            > 0
        {
            panic!(
                "\x1b[38;5;{}m some errors or warnings are exist. check the log file({})\x1b[m ",
                13, log_path
            );
        } else {
            println!(
                "\x1b[38;5;{}m some warnings are exist. check the log file({})\x1b[m ",
                11, log_path
            );
        }
    }
}
