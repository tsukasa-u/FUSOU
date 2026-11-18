#[cfg(feature = "local-test-notary-fault-injection")]
use proxy_https::notary_server::LocalTestNotaryFault;
use proxy_https::notary_server::{run_local_test_notary, LocalTestNotaryServerConfig};
use std::{net::SocketAddr, path::PathBuf, process::ExitCode};

struct Arguments {
    listen: SocketAddr,
    store: PathBuf,
    authority_key: PathBuf,
    authority_key_id: String,
    notary_key: PathBuf,
    root_certificate: PathBuf,
    ready_file: Option<PathBuf>,
    #[cfg(feature = "local-test-notary-fault-injection")]
    fault: LocalTestNotaryFault,
}

fn parse_arguments() -> Result<Arguments, String> {
    let mut listen = None;
    let mut store = None;
    let mut authority_key = None;
    let mut authority_key_id = None;
    let mut notary_key = None;
    let mut root_certificate = None;
    let mut ready_file = None;
    #[cfg(feature = "local-test-notary-fault-injection")]
    let mut fault = LocalTestNotaryFault::None;

    let mut args = std::env::args().skip(1);
    while let Some(argument) = args.next() {
        let value = args
            .next()
            .ok_or_else(|| format!("missing value for {argument}"))?;
        match argument.as_str() {
            "--listen" => {
                listen = Some(
                    value
                        .parse()
                        .map_err(|_| "invalid loopback listen address".to_owned())?,
                );
            }
            "--store" => store = Some(PathBuf::from(value)),
            "--authority-public-key" => authority_key = Some(PathBuf::from(value)),
            "--authority-key-id" => authority_key_id = Some(value),
            "--notary-signing-key" => notary_key = Some(PathBuf::from(value)),
            "--root-certificate" => root_certificate = Some(PathBuf::from(value)),
            "--ready-file" => ready_file = Some(PathBuf::from(value)),
            #[cfg(feature = "local-test-notary-fault-injection")]
            "--fault" => {
                fault = match value.as_str() {
                    "none" => LocalTestNotaryFault::None,
                    "after-admission" => LocalTestNotaryFault::ExitAfterAdmission,
                    "after-signing-claim" => LocalTestNotaryFault::ExitAfterSigningClaim,
                    _ => return Err("invalid local test fault point".to_owned()),
                };
            }
            _ => return Err(format!("unknown argument: {argument}")),
        }
    }
    Ok(Arguments {
        listen: listen.ok_or_else(|| "missing --listen".to_owned())?,
        store: store.ok_or_else(|| "missing --store".to_owned())?,
        authority_key: authority_key.ok_or_else(|| "missing --authority-public-key".to_owned())?,
        authority_key_id: authority_key_id
            .ok_or_else(|| "missing --authority-key-id".to_owned())?,
        notary_key: notary_key.ok_or_else(|| "missing --notary-signing-key".to_owned())?,
        root_certificate: root_certificate
            .ok_or_else(|| "missing --root-certificate".to_owned())?,
        ready_file,
        #[cfg(feature = "local-test-notary-fault-injection")]
        fault,
    })
}

#[tokio::main]
async fn main() -> ExitCode {
    let arguments = match parse_arguments() {
        Ok(arguments) => arguments,
        Err(error) => {
            eprintln!("local test Notary configuration error: {error}");
            return ExitCode::from(2);
        }
    };
    let config = LocalTestNotaryServerConfig {
        listen: arguments.listen,
        store_path: arguments.store,
        session_authority_public_key_path: arguments.authority_key,
        session_authority_key_id: arguments.authority_key_id,
        notary_signing_key_path: arguments.notary_key,
        root_certificate_path: arguments.root_certificate,
        ready_file: arguments.ready_file,
        #[cfg(feature = "local-test-notary-fault-injection")]
        fault: arguments.fault,
    };
    match run_local_test_notary(config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("local test Notary stopped: {error}");
            ExitCode::FAILURE
        }
    }
}
