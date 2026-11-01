use std::collections::{BTreeMap, HashSet};
use std::env;
use std::fs;
use std::path::PathBuf;

fn rust_constant_name(event_key: &str) -> String {
    let mut name = String::new();
    for (index, character) in event_key.chars().enumerate() {
        if character.is_ascii_uppercase() {
            if index > 0 {
                name.push('_');
            }
            name.push(character);
        } else if character.is_ascii_alphanumeric() {
            name.push(character.to_ascii_uppercase());
        } else {
            name.push('_');
        }
    }
    name
}

fn generate_app_events() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let event_file = manifest_dir.join("../src/utility/app_events.json");
    println!("cargo::rerun-if-changed={}", event_file.display());

    let event_json = fs::read_to_string(&event_file)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", event_file.display()));
    let events: BTreeMap<String, String> = serde_json::from_str(&event_json)
        .unwrap_or_else(|error| panic!("failed to parse {}: {error}", event_file.display()));

    let mut generated = String::new();
    let mut constant_names = HashSet::new();
    let mut event_names = HashSet::new();
    for (key, value) in events {
        let constant_name = rust_constant_name(&key);
        assert!(
            constant_names.insert(constant_name.clone()),
            "duplicate Rust event constant generated for key {key}"
        );
        assert!(!value.is_empty(), "event value for {key} cannot be empty");
        assert!(
            event_names.insert(value.clone()),
            "duplicate app event name defined for key {key}"
        );
        generated.push_str(&format!(
            "#[allow(dead_code)]\npub const {constant_name}: &str = {value:?};\n"
        ));
    }

    let output_path = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR must be set by Cargo"))
        .join("app_events.rs");
    fs::write(&output_path, generated)
        .unwrap_or_else(|error| panic!("failed to write {}: {error}", output_path.display()));
}

fn main() {
    println!("cargo::rustc-check-cfg=cfg(check_release)");

    generate_app_events();
    tauri_build::build();
    println!("cargo::rustc-env=RUST_TEST_NOCAPTURE=1");
}
