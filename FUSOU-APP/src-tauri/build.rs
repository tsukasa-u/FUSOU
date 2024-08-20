fn main() {

  tauri_build::build();
  println!("cargo:rustc-env=RUST_TEST_NOCAPTURE=1");
}
