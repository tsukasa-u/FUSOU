use dotenvy::dotenv;
use std::env;

mod check_struct_defined;
mod check_struct_dependency;

#[test]
fn test_struct_defined() {

    let mut target_path = "./../../FUSOU-PROXY-DATA/kcsapi".to_string();

    dotenv().expect(".env file not found");
    for (key, value) in env::vars() {
        if key.eq("TEST_DATA_PATH") {
            target_path = value.clone();
        }
    }

    check_struct_defined::check_struct_defined(target_path);
}

#[test]
fn test_struct_dependency() {

}