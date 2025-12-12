fn main() {
    println!("cargo::rustc-check-cfg=cfg(check_release)");

    tauri_build::build();
    println!("cargo::rustc-env=RUST_TEST_NOCAPTURE=1");
}
