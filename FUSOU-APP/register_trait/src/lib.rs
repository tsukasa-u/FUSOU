// use std::collections::HashMap;

use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path;
use std::path::PathBuf;

pub use register_macro_derive_and_attr::Getter;
pub use register_macro_derive_and_attr::TraitForTest;
pub use register_macro_derive_and_attr::TraitForRoot;
pub use register_macro_derive_and_attr::TraitForConvert;

pub use register_macro_derive_and_attr::add_field;
pub use register_macro_derive_and_attr::register_struct;
pub use register_macro_derive_and_attr::expand_struct_selector;

pub use serde_json::Value;

pub const REGISTER_STRUCT: &str = "tests-register_struct_name_env";

pub trait TraitForTest {
    fn test_type_value(&self, _: &mut LogMapType) {}
    fn test_extra(&self, _: &mut LogMapType) {}
    fn test_integration(&self, _: &mut LogMapType) {}

    // fn is_iterable(&self) -> bool { return false; }
    // fn is_result(&self) -> bool { return false; }
    // fn is_option(&self) -> bool { return false; }
    // fn is_vec(&self) -> bool { return false; }
    // fn is_hashmap(&self) -> bool { return false; }
    fn is_value(&self) -> bool { return false; }

    fn is_null(&self) -> bool { return false; }
    fn is_boolean(&self) -> bool { return false; }
    fn is_number(&self) -> bool { return false; }
    fn is_string(&self) -> bool { return false; }
    fn is_array(&self) -> bool { return false; }
    fn is_object(&self) -> bool { return false; }
}

pub type LogMapType = HashMap<(String, String, String), Vec<String>>;

pub trait TraitForRoot {
    fn test_deserialize<I>(_: I) -> LogMapType where I: Iterator<Item = PathBuf>;
}

pub trait TraitForConvert {
    fn convert<T>(&self) -> Vec<T> where T: Default { println!("not implemented"); return Vec::new(); }
}

// pub trait DummyTraitForTest {
//     fn test_type_value(&self) {}
//     fn test_extra(&self) {}
//     fn test_integration(&self) {}
// }

pub trait Getter {
    // fn get(&self) -> Box<dyn Any>;
}

//-------------------------------------------------------------------------

// Should I implement the pattern for the generic type?
macro_rules! register_trait {
    ($($type1:ty),*) => {
        $(
            impl TraitForTest for $type1 {}
        )*
    };
}

register_trait!(i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize, f32, f64, bool, char, String);

//-------------------------------------------------------------------------

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
    fn is_value(&self) -> bool { return true; }
}

//-------------------------------------------------------------------------

fn write_log(log_path: String, log_map: &LogMapType) -> usize {
    
    let mut file = File::create(log_path).expect(&format!("\x1b[38;5;{}m can not create file\x1b[m ", 8));
    
    let local: chrono::DateTime<chrono::Local> = chrono::Local::now();
    writeln!(file, "test result [{}]", local).expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
    writeln!(file, "{} / {} / {} / {}", "test_name", "struct_name", "field_name", "found types").expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));

    for ((test_name, struct_name, field_name), log) in log_map.iter() {
        writeln!(file, "{} / {} / {}: {:#?}", test_name, struct_name, field_name, log).expect(&format!("\x1b[38;5;{}m cannot write.\x1b[m ", 8));
    }
    return log_map.len();
}

pub fn simple_root_test<T>(target_path: String, pattren_str: String, log_path: String) where T: TraitForRoot {

    // let target_path = "./src/kc2api/test_data";
    let target = path::PathBuf::from(target_path);
    let files = target.read_dir().expect( &format!("\x1b[38;5;{}m read_dir call failed\x1b[m ", 8));
    let file_list = files.map(|dir_entry| {
        let file_path = dir_entry.unwrap().path();
        // file_path.exists();
        return file_path;
    })
    .filter(|file_path| {
        file_path.to_str().unwrap().ends_with(pattren_str.as_str())
    });

    custom_root_test::<T>(file_list, log_path);
}

pub fn custom_root_test<T>(file_list: impl Iterator<Item = PathBuf>, log_path: String) where T: TraitForRoot {
    
    let log_map: LogMapType = T::test_deserialize(file_list);
    
    if write_log(log_path.clone(), &log_map) > 0 {
        if log_map.iter().filter(
            |(key, log)| (key.0 == "type_value" && log.iter().position(|x| x == "null").is_some() && log.iter().position(|x| x != "null").is_some()) || key.0 != "type_value").count() > 0 {
            panic!("\x1b[38;5;{}m some errors or warnings are exist. check the log file({})\x1b[m ", 13, log_path);
        } else {
            println!("\x1b[38;5;{}m some warnings are exist. check the log file({})\x1b[m ", 11, log_path);
        }
    }
}