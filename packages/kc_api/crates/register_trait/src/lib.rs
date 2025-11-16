use std::collections::HashMap;
use std::path::PathBuf;

pub use register_macro_derive_and_attr::FieldSizeChecker;
pub use register_macro_derive_and_attr::QueryWithExtra;
pub use register_macro_derive_and_attr::TraitForDecode;
pub use register_macro_derive_and_attr::TraitForEmitData;
pub use register_macro_derive_and_attr::TraitForEncode;
pub use register_macro_derive_and_attr::TraitForRoot;
pub use register_macro_derive_and_attr::TraitForTest;

pub use register_macro_derive_and_attr::add_field;
pub use register_macro_derive_and_attr::expand_struct_selector;
pub use register_macro_derive_and_attr::insert_svg;
pub use register_macro_derive_and_attr::register_struct;

pub use serde_json::Value;

pub mod check;
pub mod test;
pub mod util;
// pub use check::custom_root_check_field_size;
// pub use check::simple_root_check_field_size;
pub use test::custom_root_test;
pub use test::simple_root_test;
pub use test::simple_root_test_with_range;

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
    fn is_value(&self) -> bool {
        false
    }

    fn is_null(&self) -> bool {
        false
    }
    fn is_boolean(&self) -> bool {
        false
    }
    fn is_number(&self) -> bool {
        false
    }
    fn is_string(&self) -> bool {
        false
    }
    fn is_array(&self) -> bool {
        false
    }
    fn is_object(&self) -> bool {
        false
    }
}

pub type LogMapType = HashMap<(String, String, String), Vec<String>>;
pub type LogMapNumberSize = HashMap<(String, String, String), Vec<i64>>;
pub enum EnumFieldNumberSize {
    U8 = 8,
    U16 = 16,
    U32 = 32,
    U64 = 64,
    U128 = 128,
    I8 = 7,
    I16 = 15,
    I32 = 31,
    I64 = 63,
    I128 = 127,
}

pub trait TraitForRoot {
    fn test_deserialize<I>(_: I) -> LogMapType
    where
        I: Iterator<Item = PathBuf>;
    // fn check_number_size<I>(_: I) -> LogMapNumberSize
    // where
    //     I: Iterator<Item = PathBuf>;
}

pub trait TraitForEmitData {}

pub trait FieldSizeChecker {
    fn check_number(&self, _: &mut LogMapNumberSize, _: Option<(String, String, String)>) {}
}

pub trait TraitForEncode {}
pub trait TraitForDecode {}

pub trait QueryWithExtra {}
