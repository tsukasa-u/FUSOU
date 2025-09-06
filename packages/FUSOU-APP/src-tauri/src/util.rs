use std::fs;
use std::io::Read;
use std::io::Write;
use std::path::PathBuf;
use tokio::sync::OnceCell;
use uuid::Uuid;

use crate::ROAMING_DIR;
static KC_USER_ENV_UNIQUE_ID: OnceCell<String> = OnceCell::const_new();

#[allow(non_snake_case)]
pub fn get_ROAMING_DIR() -> PathBuf {
    let mut path = PathBuf::new();
    {
        let roaming_path = ROAMING_DIR
            .get()
            .expect("ROAMING_DIR not found")
            .lock()
            .unwrap();
        path = roaming_path.clone();
    }
    return path;
}

#[allow(non_snake_case)]
pub fn get_RESOURCES_DIR() -> PathBuf {
    let mut path = PathBuf::new();
    {
        let resources_path = crate::RESOURCES_DIR
            .get()
            .expect("RESOURCES_DIR not found")
            .lock()
            .unwrap();
        path = resources_path.clone();
    }
    return path;
}

pub async fn get_user_env_id() -> String {
    KC_USER_ENV_UNIQUE_ID
        .get_or_init(|| async {
            let binding = get_ROAMING_DIR().join("./user");
            let directory_path = binding.as_path();

            if !fs::exists(directory_path).expect("failed to check the directory existence") {
                fs::create_dir_all(directory_path).expect("failed to create folder");
            }

            let file_path_binding = directory_path.join("./ENV_UNIQ_ID");
            let file_path = file_path_binding.as_path();

            if fs::exists(file_path).expect("failed to check the file existence") {
                let mut file = fs::File::open(file_path).expect("file not found");
                let mut contents = String::new();
                file.read_to_string(&mut contents)
                    .expect("something went wrong reading the file");
                contents
            } else {
                let mut file = fs::File::create(file_path).expect("failed to create file.");

                let new_uuid = Uuid::new_v4().to_string();
                writeln!(file, "{new_uuid}").expect("cannot write.");
                new_uuid
            }
        })
        .await
        .clone()
}

#[allow(dead_code)]
pub fn type_of<T>(_: &T) -> &'static str {
    std::any::type_name::<T>()
}
