#![forbid(unsafe_code)]

use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::os::unix::fs::FileExt;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("echo");
    match mode {
        "echo" => {
            // Positional reads deliberately ignore the memfd's shared open-description cursor.
            let file = std::fs::File::from(std::io::stdin().as_fd().try_clone_to_owned()?);
            let mut chunk = [0; 8192];
            let mut offset = 0;
            loop {
                let count = file.read_at(&mut chunk, offset)?;
                if count == 0 {
                    break;
                }
                std::io::stdout().write_all(&chunk[..count])?;
                offset += count as u64;
            }
        }
        "digest" => {
            let file = std::fs::File::from(std::io::stdin().as_fd().try_clone_to_owned()?);
            let mut bytes = vec![0; usize::try_from(file.metadata()?.len())?];
            file.read_exact_at(&mut bytes, 0)?;
            let hash = Sha256::digest(&bytes);
            for byte in hash {
                print!("{byte:02x}");
            }
        }
        "flood" | "stdout" | "stderr" => {
            let mode_copy = mode.to_string();
            let out = std::thread::spawn(move || -> std::io::Result<()> {
                if mode_copy != "stderr" {
                    for _ in 0..128 {
                        std::io::stdout().write_all(&[b'O'; 8192])?;
                    }
                }
                Ok(())
            });
            if mode != "stdout" {
                for _ in 0..128 {
                    std::io::stderr().write_all(&[b'E'; 8192])?;
                }
            }
            out.join()
                .map_err(|_| "synthetic output thread panicked")??;
        }
        "sleep" => std::thread::sleep(std::time::Duration::from_secs(30)),
        "paired" => {
            let out = std::thread::spawn(|| std::io::stdout().write_all(&[b'O'; 8192]));
            std::io::stderr().write_all(&[b'E'; 8192])?;
            out.join()
                .map_err(|_| "synthetic output thread panicked")??;
        }
        "exit127" => std::process::exit(127),
        "signal" => {
            nix::sys::signal::raise(nix::sys::signal::Signal::SIGTERM)?;
        }
        "fds" => {
            // /proc is used only to inspect the fixture's FD table, never as an exec/input path.
            let mut descriptors = Vec::new();
            for entry in std::fs::read_dir("/proc/self/fd")? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if let Ok(target) = std::fs::read_link(entry.path()) {
                    if target
                        != std::path::PathBuf::from(format!("/proc/{}/fd", std::process::id()))
                    {
                        descriptors.push(name.parse::<i32>()?);
                    }
                }
            }
            descriptors.sort();
            println!("{descriptors:?}");
            let env: Vec<_> = std::env::vars().collect();
            println!("{env:?}");
        }
        "ordinary-read" => {
            let mut bytes = Vec::new();
            std::io::stdin().read_to_end(&mut bytes)?;
            std::io::stdout().write_all(&bytes)?;
        }
        _ => return Err("unsupported fixed synthetic mode".into()),
    }
    Ok(())
}

use std::os::fd::AsFd;
