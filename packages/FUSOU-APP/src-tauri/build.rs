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

fn windows_manifest_build() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os != "windows" || target_env != "msvc" {
        tauri_build::build();
        return;
    }

    // `tauri_build::build()` only links `resource.lib` (containing the ComCtl32 v6 manifest)
    // into `bin` targets, causing `cargo test --lib` (`app_lib`) to fail with
    // `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` on `comctl32.dll::TaskDialogIndirect`.
    // Omit the manifest from `resource.lib` and embed the exact same Common-Controls v6
    // manifest via MSVC linker args so both `bin` and `--lib` test executables receive it
    // without a duplicate `CVT1100` RT_MANIFEST resource error.
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attributes).expect("failed to run tauri-build");

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR must be set by Cargo"));
    let manifest_path = out_dir.join("windows_comctl32.manifest");
    let manifest = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#;
    fs::write(&manifest_path, manifest)
        .unwrap_or_else(|error| panic!("failed to write {}: {error}", manifest_path.display()));
    println!("cargo::rustc-link-arg=/MANIFEST:EMBED");
    println!(
        "cargo::rustc-link-arg=/MANIFESTINPUT:{}",
        manifest_path.display()
    );
}

fn main() {
    println!("cargo::rustc-check-cfg=cfg(check_release)");

    generate_app_events();
    windows_manifest_build();
    println!("cargo::rustc-env=RUST_TEST_NOCAPTURE=1");
}
