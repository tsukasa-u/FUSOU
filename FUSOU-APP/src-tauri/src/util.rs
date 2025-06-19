use std::fs;
use std::path;
use uuid::Uuid;

#[allow(dead_code)]
pub fn type_of<T>(_: &T) -> &'static str {
    std::any::type_name::<T>()
}

static KC_USER_ENV_UNIQUE_ID: OnceCell<String> = OnceCell::const_new();

pub fn get_user_env_id() -> String {
    KC_USER_ENV_UNIQUE_ID
        .get_or_init(|| {
            #[cfg(dev)]
            let directory_path = path::Path::new("./user");
            #[cfg(any(not(dev), check_release))]
            let directory_path = ROAMING_DIR
                .get()
                .expect("ROAMING_DIR not found")
                .join("./user")
                .as_path();

            if !fs::exists(directory_path).expect("failed to check the directory existence") {
                fs::create_dir_all(directory_path).expect("failed to create folder");
            }

            let file_path = directory_path.join("./ENV_UNIQ_ID").as_path();

            let new_uuid = if fs::exists(file_path).expect("failed to check the file existence") {
                let mut file = File::open(file_path).expect("file not found");
                let mut contents = String::new();
                f.read_to_string(&mut contents)
                    .expect("something went wrong reading the file");
                contents
            } else {
                let mut file = File::create(file_path).expect("failed to create file.");

                let new_uuid = Uuid::new_v4().to_string();
                writeln!(file, "{}", new_uuid).expect("cannot write.");
                new_uuid
            };

            return new_uuid;
        })
        .clone()
}
