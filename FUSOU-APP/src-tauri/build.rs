fn main() {
  // println!("cargo:rustc-cfg=TAURI_BUILD_DEBUG");
  
  if std::env::var("TAURI_BUILD_DEBUG").is_ok() {
    println!("cargo:rustc-cfg=TAURI_BUILD_DEBUG");
    println!("cargo::rustc-check-cfg=cfg(TAURI_BUILD_DEBUG)");
  }
  println!("cargo:warning={:?}", std::env::var("TAURI_BUILD_DEBUG"));

  tauri_build::build();
  println!("cargo:rustc-env=RUST_TEST_NOCAPTURE=1");
}
