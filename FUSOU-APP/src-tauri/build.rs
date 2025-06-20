use std::env;
use std::fs::File;
use std::io::Write;

fn main() {
    println!("cargo::rustc-check-cfg=cfg(check_release)");

    // match env::var("CHECK_RELEASE") {
    //     Ok(var) => match var.as_str() {
    //         "NO_CHECK" => {}
    //         _ => println!("cargo::rustc-cfg=check_release"),
    //     },
    //     Err(_) => println!("cargo::rustc-cfg=check_release"),
    // }

    // echo "export const env = { SUPABASE_URL: ${{ secrets.SUPABASE_URL }}, SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}}" > ../src/pages/vanilla/env.js
    {
        let path = "../src/pages/vanilla/env.js";
        let mut file = File::create(path).expect("failed to create file.");

        writeln!(
            file,
            "export const env = {{ SUPABASE_URL: {}, SUPABASE_ANON_KEY: {}}}",
            env::var("SUPABASE_URL").expect("failed to get env variable"),
            env::var("SUPABASE_ANON_KEY").expect("failed to get env variable")
        )
        .expect("cannot write.");
    }

    tauri_build::build();
    println!("cargo::rustc-env=RUST_TEST_NOCAPTURE=1");
}
