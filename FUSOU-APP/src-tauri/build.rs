fn main() {
    // println!("cargo:rustc-cfg=TAURI_BUILD_DEBUG");
    println!("cargo:rustc-check-cfg=cfg(TAURI_BUILD_TYPE, values(\"DEBUG\"))");
    println!("cargo:rustc-check-cfg=cfg(TAURI_BUILD_TYPE, values(\"RELEASE\"))");
    match std::env::var("TAURI_BUILD_TYPE") {
        Ok(val) => {
            if val == "DEBUG" {
                println!("cargo:rustc-cfg=TAURI_BUILD_TYPE=\"DEBUG\"");
            } else if val == "RELEASE" {
                println!("cargo:rustc-cfg=TAURI_BUILD_TYPE=\"RELEASE\"");
            }
        }
        Err(_) => {
            println!("cargo:rustc-cfg=TAURI_BUILD_TYPE=\"DEBUG\"");
        }
    }

    tauri_build::build();
    println!("cargo:rustc-env=RUST_TEST_NOCAPTURE=1");
}
