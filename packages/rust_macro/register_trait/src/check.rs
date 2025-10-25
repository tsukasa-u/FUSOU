use core::panic;
use std::collections::HashMap;

use crate::EnumFieldNumberSize;
use crate::FieldSizeChecker;
use crate::LogMapNumberSize;
// use crate::TraitForRoot;
use serde_json::Value;

use std::fs::File;
use std::io::Write;
// use std::path;
// use std::path::PathBuf;

use std::collections::hash_map;

impl<T> FieldSizeChecker for Vec<T>
where
    T: FieldSizeChecker,
{
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        for v in self {
            v.check_number(log_map, key.clone());
        }
    }
}

impl<T> FieldSizeChecker for Option<T>
where
    T: FieldSizeChecker,
{
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(v) = self {
            v.check_number(log_map, key.clone())
        }
    }
}

impl<T, U> FieldSizeChecker for HashMap<T, U>
where
    T: FieldSizeChecker,
    U: FieldSizeChecker,
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

impl FieldSizeChecker for Value {
    fn check_number(&self, _: &mut LogMapNumberSize, _: Option<(String, String, String)>) {}
}

impl FieldSizeChecker for i8 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..7)
                .rposition(|x| ((*self).unsigned_abs() & (1u8 << x)) != 0)
                .unwrap_or(0) as i64
                + 1i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![
                    *self as i64,
                    *self as i64,
                    bit_size,
                    EnumFieldNumberSize::I8 as i64,
                ]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}

impl FieldSizeChecker for i16 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..15)
                .rposition(|x| ((*self).unsigned_abs() & (1u16 << x)) != 0)
                .unwrap_or(0) as i64
                + 1i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![
                    *self as i64,
                    *self as i64,
                    bit_size,
                    EnumFieldNumberSize::I16 as i64,
                ]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}

impl FieldSizeChecker for i32 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..31)
                .rposition(|x| ((*self).unsigned_abs() & (1u32 << x)) != 0)
                .unwrap_or(0) as i64
                + 1i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![
                    *self as i64,
                    *self as i64,
                    bit_size,
                    EnumFieldNumberSize::I32 as i64,
                ]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}

impl FieldSizeChecker for i64 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..64)
                .rposition(|x| ((*self).unsigned_abs() & (1u64 << x)) != 0)
                .unwrap_or(0) as i64
                + 1i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![
                    *self,
                    *self,
                    bit_size,
                    EnumFieldNumberSize::I64 as i64,
                ]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self);
                value[1] = value[1].max(*self);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}

impl FieldSizeChecker for i128 {
    fn check_number(&self, _: &mut LogMapNumberSize, _: Option<(String, String, String)>) {
        println!("not implemented");
    }
}

impl FieldSizeChecker for u8 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..8)
                .rposition(|x| (*self & (1u8 << x)) != 0)
                .unwrap_or(0) as i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![
                    *self as i64,
                    *self as i64,
                    bit_size,
                    EnumFieldNumberSize::U8 as i64,
                ]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}

impl FieldSizeChecker for u16 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..16)
                .rposition(|x| (*self & (1u16 << x)) != 0)
                .unwrap_or(0) as i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![
                    *self as i64,
                    *self as i64,
                    bit_size,
                    EnumFieldNumberSize::U16 as i64,
                ]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}

impl FieldSizeChecker for u32 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..32)
                .rposition(|x| (*self & (1u32 << x)) != 0)
                .unwrap_or(0) as i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![
                    *self as i64,
                    *self as i64,
                    bit_size,
                    EnumFieldNumberSize::U32 as i64,
                ]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}

impl FieldSizeChecker for u64 {
    fn check_number(&self, log_map: &mut LogMapNumberSize, key: Option<(String, String, String)>) {
        if let Some(key) = key {
            let bit_size = (0usize..64)
                .rposition(|x| (*self & (1u64 << x)) != 0)
                .unwrap_or(0) as i64;
            if let hash_map::Entry::Vacant(e) = log_map.entry(key.clone()) {
                e.insert(vec![
                    *self as i64,
                    *self as i64,
                    bit_size,
                    EnumFieldNumberSize::U64 as i64,
                ]);
            } else {
                let value = log_map.get_mut(&key).unwrap();
                value[0] = value[0].min(*self as i64);
                value[1] = value[1].max(*self as i64);
                value[2] = value[2].max(bit_size);
            }
        }
    }
}

impl FieldSizeChecker for u128 {
    fn check_number(&self, _: &mut LogMapNumberSize, _: Option<(String, String, String)>) {
        println!("not implemented");
    }
}

impl FieldSizeChecker for isize {}
impl FieldSizeChecker for usize {}
impl FieldSizeChecker for f32 {}
impl FieldSizeChecker for f64 {}
impl FieldSizeChecker for bool {}
impl FieldSizeChecker for char {}
impl FieldSizeChecker for String {}

impl FieldSizeChecker for uuid::Uuid {}

//-------------------------------------------------------------------------

pub fn write_log_check_field_size(log_path: String, log_map: &LogMapNumberSize) -> usize {
    let mut file =
        File::create(log_path).expect(&format!("\x1b[38;5;{}m can not create file\x1b[m ", 8));

    let local: chrono::DateTime<chrono::Local> = chrono::Local::now();
    writeln!(file, "check number size result [{}]", local)
        .expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
    writeln!(
        file,
        "struct_name / field_name / type_name: min, max, bit_size, size",
    )
    .expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));

    let mut invalid_count = 0;
    for ((struct_name, field_name, type_name), log) in log_map.iter() {
        let bit_size = log[2];
        let abs_size = log[3];
        // let min_num = log[0];
        // check the int type is i32 or i64. others are invalid.
        let unmatch_sign_flag = abs_size % 2 == 0;
        let unmatch_range_flag = match abs_size {
            x if x == EnumFieldNumberSize::U8 as i64 => true, // u8 is not supported in avro schema
            x if x == EnumFieldNumberSize::U16 as i64 => true, // u16 is not supported in avro schema
            x if x == EnumFieldNumberSize::U32 as i64 => true, // u32 is not supported in avro schema
            x if x == EnumFieldNumberSize::U64 as i64 => true, // u64 is not supported in avro schema
            x if x == EnumFieldNumberSize::I8 as i64 => true,  // i8 is not supported in avro schema
            x if x == EnumFieldNumberSize::I16 as i64 => true, // i16 is not supported in avro schema
            x if x == EnumFieldNumberSize::I32 as i64 => bit_size > 31,
            x if x == EnumFieldNumberSize::I64 as i64 => bit_size > 63 || bit_size <= 31,
            _ => panic!("unknown size. not implemented"),
        };

        if unmatch_range_flag || unmatch_sign_flag {
            invalid_count += 1;
            let size_name = match log[3] {
                x if x == EnumFieldNumberSize::U8 as i64 => "u8",
                x if x == EnumFieldNumberSize::U16 as i64 => "u16",
                x if x == EnumFieldNumberSize::U32 as i64 => "u32",
                x if x == EnumFieldNumberSize::U64 as i64 => "u64",
                x if x == EnumFieldNumberSize::I8 as i64 => "i8",
                x if x == EnumFieldNumberSize::I16 as i64 => "i16",
                x if x == EnumFieldNumberSize::I32 as i64 => "i32",
                x if x == EnumFieldNumberSize::I64 as i64 => "i64",
                _ => "unknown",
            };
            if unmatch_sign_flag {
                writeln!(
                    file,
                    "{} / {} / {}: {}, {}, {}, {}  <-- sign mismatch",
                    struct_name, field_name, type_name, log[0], log[1], log[2], size_name
                )
                .expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
            } else {
                writeln!(
                    file,
                    "{} / {} / {}: {}, {}, {}, {}  <-- range mismatch",
                    struct_name, field_name, type_name, log[0], log[1], log[2], size_name
                )
                .expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
            }
        }
    }
    // file.write_all(format!("{:#?}", log_map).as_bytes())
    //     .expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
    return invalid_count;
}

// pub fn simple_root_check_field_size<T>(target_path: String, pattren_str: String, log_path: String)
// where
//     T: TraitForRoot + FieldSizeChecker,
// {
//     let target = path::PathBuf::from(target_path);
//     let files = target
//         .read_dir()
//         .expect(&format!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
//     let file_list = files
//         .map(|dir_entry| {
//             let file_path = dir_entry.unwrap().path();
//             // file_path.exists();
//             return file_path;
//         })
//         .filter(|file_path| file_path.to_str().unwrap().ends_with(pattren_str.as_str()));

//     custom_root_check_field_size::<T>(file_list, log_path);
// }

// pub fn custom_root_check_field_size<T>(file_list: impl Iterator<Item = PathBuf>, log_path: String)
// where
//     T: TraitForRoot + FieldSizeChecker,
// {
//     let log_map: LogMapNumberSize = T::check_number_size(file_list);

//     if write_log_check_field_size(log_path.clone(), &log_map) > 0 {
//         println!(
//             "\x1b[38;5;{}m some warnings are exist. check the log file({})\x1b[m ",
//             11, log_path
//         );
//     }
// }
