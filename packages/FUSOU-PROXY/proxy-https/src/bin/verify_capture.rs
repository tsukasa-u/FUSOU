use std::{env, path::PathBuf, process::ExitCode};

use proxy_https::capture::{verify_capture_evidence, verify_natural_capture_review};

fn main() -> ExitCode {
    let mut arguments = env::args_os();
    let _program = arguments.next();
    let Some(capture_dir) = arguments.next() else {
        eprintln!("usage: verify_capture <capture-directory> [natural-review.json]");
        return ExitCode::from(2);
    };
    let review_path = arguments.next().map(PathBuf::from);
    if arguments.next().is_some() {
        eprintln!("usage: verify_capture <capture-directory> [natural-review.json]");
        return ExitCode::from(2);
    }

    let capture_dir = PathBuf::from(capture_dir);
    if let Some(review_path) = review_path {
        match verify_natural_capture_review(&capture_dir, review_path) {
            Ok(verification) => {
                println!("capture_dir={}", capture_dir.display());
                println!("review_id={}", verification.review_id);
                println!("natural_provenance={}", verification.natural_provenance);
                println!("privacy_qualified={}", verification.privacy_qualified);
                println!(
                    "external_transmission_status={}",
                    verification.external_transmission_status
                );
                println!("privacy_disposition={}", verification.privacy_disposition);
                println!(
                    "p0_04={}",
                    if verification.natural_provenance && verification.privacy_qualified {
                        "READY"
                    } else {
                        "BLOCKED"
                    }
                );
                println!("request_sha256={}", verification.capture.request_sha256);
                println!("response_sha256={}", verification.capture.response_sha256);
                println!(
                    "complete_artifact_sha256={}",
                    verification.capture.complete_artifact_sha256
                );
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("natural capture review failed: {error}");
                ExitCode::from(1)
            }
        }
    } else {
        match verify_capture_evidence(&capture_dir) {
            Ok(verification) => {
                println!("capture_dir={}", capture_dir.display());
                println!("request_sha256={}", verification.request_sha256);
                println!("response_sha256={}", verification.response_sha256);
                println!(
                    "complete_artifact_sha256={}",
                    verification.complete_artifact_sha256
                );
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("capture verification failed: {error}");
                ExitCode::from(1)
            }
        }
    }
}
