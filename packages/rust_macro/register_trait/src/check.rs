use std::collections::hash_map;
use std::collections::HashMap;

use crate::LogMapNumberSize;
use crate::NumberSizeChecker;
use crate::TraitForRoot;
use serde_json::Value;

use std::fs::File;
use std::io::Write;
use std::path;
use std::path::PathBuf;

impl<T> NumberSizeChecker for Vec<T>
where
    T: NumberSizeChecker,
{
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        for v in self {
            v.check_number(log_map, key.clone());
        }
    }
}

impl<T> NumberSizeChecker for Option<T>
where
    T: NumberSizeChecker,
{
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(v) = self {
            v.check_number(log_map, key.clone())
        }
    }
}

impl<T, U> NumberSizeChecker for HashMap<T, U>
where
    T: NumberSizeChecker,
    U: NumberSizeChecker,
{
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        for (k, v) in self {
            v.check_number(log_map, key.clone());
            k.check_number(
                log_map,
                (
                    key.clone().unwrap().0,
                    key.clone().unwrap().1,
                    format!("key__{}", key.clone().unwrap().2),
                )
                    .into(),
            );
        }
    }
}

impl NumberSizeChecker for Value {
    fn check_number(&self, _: &mut LogMapNumberSize, _: Option<(String, String, String)>) {}
}

impl NumberSizeChecker for i8 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..7)
                .rposition(|x| ((*self).unsigned_abs() & (1u8 << x)) != 0)
                .unwrap_or(0) as i64
                + 1i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![*self as i64, *self as i64, bit_size]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}
impl NumberSizeChecker for i16 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..15)
                .rposition(|x| ((*self).unsigned_abs() & (1u16 << x)) != 0)
                .unwrap_or(0) as i64
                + 1i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![*self as i64, *self as i64, bit_size]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}
impl NumberSizeChecker for i32 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..31)
                .rposition(|x| ((*self).unsigned_abs() & (1u32 << x)) != 0)
                .unwrap_or(0) as i64
                + 1i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![*self as i64, *self as i64, bit_size]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}
impl NumberSizeChecker for i64 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..64)
                .rposition(|x| ((*self).unsigned_abs() & (1u64 << x)) != 0)
                .unwrap_or(0) as i64
                + 1i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![*self, *self, bit_size]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self);
                value[1] = value[1].max(*self);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}
impl NumberSizeChecker for i128 {
    fn check_number(&self, _: &mut LogMapNumberSize, _: Option<(String, String, String)>) {
        println!("not implemented");
    }
}

impl NumberSizeChecker for u8 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..8)
                .rposition(|x| (*self & (1u8 << x)) != 0)
                .unwrap_or(0) as i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![*self as i64, *self as i64, bit_size]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}
impl NumberSizeChecker for u16 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..16)
                .rposition(|x| (*self & (1u16 << x)) != 0)
                .unwrap_or(0) as i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![*self as i64, *self as i64, bit_size]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}
impl NumberSizeChecker for u32 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..32)
                .rposition(|x| (*self & (1u32 << x)) != 0)
                .unwrap_or(0) as i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![*self as i64, *self as i64, bit_size]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}
impl NumberSizeChecker for u64 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..64)
                .rposition(|x| (*self & (1u64 << x)) != 0)
                .unwrap_or(0) as i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![*self as i64, *self as i64, bit_size]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}

impl NumberSizeChecker for u128 {
    fn check_number(&self, _: &mut LogMapNumberSize, _: Option<(String, String, String)>) {
        println!("not implemented");
    }
}

impl NumberSizeChecker for isize {}
impl NumberSizeChecker for usize {}
impl NumberSizeChecker for f32 {}
impl NumberSizeChecker for f64 {}
impl NumberSizeChecker for bool {}
impl NumberSizeChecker for char {}
impl NumberSizeChecker for String {}

//-------------------------------------------------------------------------

fn write_log_check_number_size(log_path: String, log_map: &LogMapNumberSize) -> usize {
    let mut file =
        File::create(log_path).expect(&format!("\x1b[38;5;{}m can not create file\x1b[m ", 8));

    let local: chrono::DateTime<chrono::Local> = chrono::Local::now();
    writeln!(file, "check number size result [{}]", local)
        .expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
    // file.write_all(format!("{:#?}", log_map).as_bytes())
    //     .expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
    for ((struct_name, field_name, type_name), log) in log_map.iter() {
        writeln!(
            file,
            "{} / {} / {}: {:#?}",
            struct_name, field_name, type_name, log
        )
        .expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
    }
    return log_map.len();
}

pub fn simple_root_check_number_size<T>(target_path: String, pattren_str: String, log_path: String)
where
    T: TraitForRoot + NumberSizeChecker,
{
    // let target_path = "./src/kc2api/test_data";
    let target = path::PathBuf::from(target_path);
    let files = target
        .read_dir()
        .expect(&format!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let file_list = files
        .map(|dir_entry| {
            let file_path = dir_entry.unwrap().path();
            // file_path.exists();
            return file_path;
        })
        .filter(|file_path| file_path.to_str().unwrap().ends_with(pattren_str.as_str()));

    custom_root_check_number_size::<T>(file_list, log_path);
}

pub fn custom_root_check_number_size<T>(file_list: impl Iterator<Item = PathBuf>, log_path: String)
where
    T: TraitForRoot + NumberSizeChecker,
{
    let log_map: LogMapNumberSize = T::check_number_size(file_list);

    write_log_check_number_size(log_path.clone(), &log_map);
}
