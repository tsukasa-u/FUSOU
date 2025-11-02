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
