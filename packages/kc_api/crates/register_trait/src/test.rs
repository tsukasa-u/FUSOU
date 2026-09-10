use crate::{LogMapType, TraitForRoot, TraitForTest};
use serde_json::Value;

use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

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

pub fn get_timestamp_from_file(file_path: &std::path::Path) -> Option<i64> {
    // 1. Fast path: check file name prefix before @ (in-memory string parse, no disk IO)
    if let Some(file_name) = file_path.file_name().and_then(|n| n.to_str()) {
        if let Some((prefix, _)) = file_name.split_once('@') {
            let trimmed = prefix.strip_suffix(|c: char| c == 'S' || c == 'Q').unwrap_or(prefix);
            if let Ok(ts) = trimmed.parse::<i64>() {
                if ts > 1_000_000_000 && ts < 2_500_000_000 {
                    return Some(ts);
                }
            }
            if trimmed.len() >= 15 && trimmed.as_bytes().get(8) == Some(&b'_') {
                if let (Ok(year), Ok(month), Ok(day), Ok(hour), Ok(min), Ok(sec)) = (
                    trimmed[0..4].parse::<i32>(),
                    trimmed[4..6].parse::<u32>(),
                    trimmed[6..8].parse::<u32>(),
                    trimmed[9..11].parse::<u32>(),
                    trimmed[11..13].parse::<u32>(),
                    trimmed[13..15].parse::<u32>(),
                ) {
                    use chrono::{FixedOffset, NaiveDate, TimeZone};
                    if let Some(jst) = FixedOffset::east_opt(9 * 3600) {
                        if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
                            if let Some(dt) = date.and_hms_opt(hour, min, sec) {
                                if let Some(dt_jst) = jst.from_local_datetime(&dt).single() {
                                    return Some(dt_jst.timestamp());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    // 2. Slow fallback: read first 512 bytes for Timestamp header
    use std::io::Read;
    if let Ok(mut file) = std::fs::File::open(file_path) {
        let mut buf = [0u8; 512];
        if let Ok(n) = file.read(&mut buf) {
            let header = String::from_utf8_lossy(&buf[..n]);
            for line in header.lines() {
                if let Some(rest) = line.strip_prefix("Timestamp: ") {
                    if let Ok(ts) = rest.trim().parse::<i64>() {
                        return Some(ts);
                    }
                }
            }
        }
    }
    None
}

pub fn get_timestamp_from_file_content(file_path: PathBuf) -> String {
    get_timestamp_from_file(&file_path)
        .map(|ts| ts.to_string())
        .unwrap_or_else(|| "0".to_string())
}

pub fn collect_test_data_files(base_path: &std::path::Path) -> Vec<PathBuf> {
    let mut result = Vec::new();
    if !base_path.exists() {
        eprintln!(
            "Warning: test data path does not exist: {}",
            base_path.display()
        );
        return result;
    }

    fn is_test_file(name: &str) -> bool {
        name.contains("@api_") && (name.contains("S@") || name.contains("Q@"))
    }

    fn walk(p: &std::path::Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > 4 {
            return;
        }
        if let Ok(entries) = std::fs::read_dir(p) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let dir_name = entry.file_name();
                    let dir_str = dir_name.to_string_lossy();
                    if dir_str == ".git"
                        || dir_str == "node_modules"
                        || dir_str == "target"
                        || dir_str == "storybook"
                        || dir_str == "FAILED"
                    {
                        continue;
                    }
                    walk(&path, depth + 1, out);
                } else if path.is_file() {
                    let file_name = entry.file_name();
                    let file_str = file_name.to_string_lossy();
                    if is_test_file(&file_str) {
                        out.push(path);
                    }
                }
            }
        }
    }

    walk(base_path, 0, &mut result);
    result
}

static CACHED_FILES: OnceLock<Vec<PathBuf>> = OnceLock::new();

pub fn get_cached_test_data_files(target_path: &str) -> &'static [PathBuf] {
    CACHED_FILES.get_or_init(|| {
        let files = collect_test_data_files(std::path::Path::new(target_path));
        let mut timed_files: Vec<(PathBuf, i64)> = files
            .into_iter()
            .map(|p| {
                let ts = get_timestamp_from_file(&p).unwrap_or(0);
                (p, ts)
            })
            .collect();
        timed_files.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        timed_files.into_iter().map(|(p, _)| p).collect()
    })
}

pub fn active_epoch_range() -> (Option<i64>, Option<i64>) {
    let date_str = env!("SELECTED_DATE");
    let date = date_str.parse::<u32>().unwrap_or(0);
    if date == 0 {
        (None, kc_api_build_config::first_epoch_unix())
    } else {
        let start = kc_api_build_config::get_epoch_unix(date);
        let mut all_dates = kc_api_build_config::all_known_epoch_dates();
        all_dates.sort_unstable();
        let end = all_dates
            .iter()
            .copied()
            .find(|&d| d > date)
            .and_then(kc_api_build_config::get_epoch_unix);
        (start, end)
    }
}

pub fn filter_range_start_end(
    file_path: PathBuf,
    range_start: Option<i64>,
    range_end: Option<i64>,
) -> bool {
    let ts_int = match get_timestamp_from_file(&file_path) {
        Some(ts) => ts,
        None => return false,
    };
    match (range_start, range_end) {
        (Some(start), Some(end)) => ts_int >= start && ts_int < end,
        (Some(start), None) => ts_int >= start,
        (None, Some(end)) => ts_int < end,
        (None, None) => true,
    }
}

pub fn simple_root_test_with_range<T>(
    target_path: String,
    pattern_str: String,
    log_path: String,
    range_start: Option<i64>,
    range_end: Option<i64>,
) where
    T: TraitForRoot,
{
    let files = get_cached_test_data_files(&target_path);
    let file_list = files
        .iter()
        .filter(|file_path| {
            let s = file_path.to_str().unwrap_or("");
            let base = s.strip_suffix(".json").unwrap_or(s);
            base.ends_with(pattern_str.as_str())
                && filter_range_start_end((*file_path).clone(), range_start, range_end)
        })
        .cloned();

    custom_root_test::<T>(file_list, log_path);
}

pub fn simple_root_test<T>(target_path: String, pattern_str: String, log_path: String)
where
    T: TraitForRoot,
{
    let (range_start, range_end) = active_epoch_range();
    simple_root_test_with_range::<T>(target_path, pattern_str, log_path, range_start, range_end);
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
