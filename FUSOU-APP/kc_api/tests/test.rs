use dotenvy::dotenv;
use std::env;

mod check_database_dependency;
mod check_struct_defined;
mod check_struct_dependency;
pub mod util;

fn target_path() -> String {
    let mut target_path = "./../../FUSOU-PROXY-DATA/kcsapi".to_string();

    dotenv().expect(".env file not found");
    for (key, value) in env::vars() {
        if key.eq("TEST_DATA_PATH") {
            target_path = value.clone();
        }
    }

    target_path
}

#[test]
fn test_struct_defined() {
    let target_path = target_path();

    check_struct_defined::check_struct_defined(target_path);
}

#[test]
fn test_struct_dependency() {
    check_struct_dependency::check_struct_dependency();
}

#[test]
fn test_database_dependency() {
    check_database_dependency::check_database_dependency();
}
