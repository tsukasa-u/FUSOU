// use std::env;

use std::path::{self, PathBuf};

fn main() {
    println!("cargo::rustc-check-cfg=cfg(check_release)");

    // match env::var("CHECK_RELEASE") {
    //     Ok(var) => match var.as_str() {
    //         "NO_CHECK" => {}
    //         _ => println!("cargo::rustc-cfg=check_release"),
    //     },
    //     Err(_) => println!("cargo::rustc-cfg=check_release"),
    // }

    std::fs::create_dir_all("./tests/struct_dependency_svg").expect("create dir failed");
    std::fs::write("./tests/struct_dependency_svg/all.svg", b"").expect("failed to write svg");

    std::fs::create_dir_all("./tests/database_dependency_svg").expect("create dir failed");
    std::fs::write("./tests/database_dependency_svg/all.svg", b"").expect("failed to write svg");

    let target_path = "./src/kcapi".to_string();

    let target = path::PathBuf::from(target_path);
    let folders = target.read_dir().expect("read_dir call failed");

    for dir_entry in folders {
        if dir_entry.is_ok() {
            let dir_entry_path = dir_entry.unwrap().path();

            if dir_entry_path.clone().is_dir() {
                let files = dir_entry_path.read_dir().expect("read_dir call failed");
                for entry in files.flatten() {
                    let file_path = entry.path();
                    let file_path_str = file_path.to_string_lossy().to_string();

                    if file_path_str.ends_with(".rs") && !file_path_str.ends_with("mod.rs") {
                        #[cfg(target_os = "windows")]
                        let api_name_splited: Vec<String> = file_path_str
                            .replace("\\", "/")
                            .split("/")
                            .map(|s| s.replace(".rs", ""))
                            .collect();
                        #[cfg(target_os = "linux")]
                        let api_name_splited: Vec<String> = file_path_str
                            .split("/")
                            .map(|s| s.replace(".rs", ""))
                            .collect();

                        let api_name_1 = api_name_splited[api_name_splited.len() - 2].clone();
                        let api_name_2 = api_name_splited[api_name_splited.len() - 1].clone();

                        let svg_file_path = format!(
                            "./tests/database_dependency_svg/{}@{}.svg",
                            api_name_1, api_name_2
                        );

                        if !std::fs::exists(svg_file_path.clone())
                            .expect("failed to check the file exist")
                        {
                            std::fs::write(svg_file_path, b"").expect("failed to write svg file");
                        }
                    }
                }
            }
        }
    }

    tauri_build::build();
    println!("cargo::rustc-env=RUST_TEST_NOCAPTURE=1");
}
