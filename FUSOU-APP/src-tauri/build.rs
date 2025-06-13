// use std::env;

fn main() {
    println!("cargo::rustc-check-cfg=cfg(check_release)");

    // match env::var("CHECK_RELEASE") {
    //     Ok(var) => match var.as_str() {
    //         "NO_CHECK" => {}
    //         _ => println!("cargo::rustc-cfg=check_release"),
    //     },
    //     Err(_) => println!("cargo::rustc-cfg=check_release"),
    // }

    tauri_build::build();
    println!("cargo::rustc-env=RUST_TEST_NOCAPTURE=1");
}
