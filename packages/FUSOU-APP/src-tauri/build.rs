#[cfg(feature = "auth-local-server")]
use std::{env, fs::File, io::Write};

fn main() {
    println!("cargo::rustc-check-cfg=cfg(check_release)");

    // println!("cargo::rustc-cfg=check_release");

    // echo "export const env = { SUPABASE_URL: ${{ secrets.SUPABASE_URL }}, SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}}" > ../src/pages/vanilla/env.js
    #[cfg(feature = "auth-local-server")]
    {
        let path = "../src/pages/vanilla/env.js";
        let mut file = File::create(path).expect("failed to create file.");

        let supabase_url = match env::var("SUPABASE_URL") {
            Ok(url) => url,
            Err(e) => {
                eprintln!("failed to get env variable SUPABASE_URL: {}", e);
                return;
            }
        };
        let supabase_anon_key = match env::var("SUPABASE_ANON_KEY") {
            Ok(key) => key,
            Err(e) => {
                eprintln!("failed to get env variable SUPABASE_ANON_KEY: {}", e);
                return;
            }
        };
        if let Err(e) = writeln!(
            file,
            "export const env = {{ SUPABASE_URL: \"{}\", SUPABASE_ANON_KEY: \"{}\"}}",
            supabase_url,
            supabase_anon_key
        ) {
            eprintln!("cannot write to file: {}", e);
        }
    }

    tauri_build::build();
    println!("cargo::rustc-env=RUST_TEST_NOCAPTURE=1");
}
