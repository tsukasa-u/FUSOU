use fusou_tlsn_verifier::experimental_compat::{run, CompatibilityProbeConfig, HeaderMode};

const USAGE: &str = "usage: experimental-require-info-compat --acknowledge-live-request --mode <with-header|without-header> [--binding <value>]";

#[tokio::main]
async fn main() {
    let action = match parse_args(std::env::args().skip(1)) {
        Ok(action) => action,
        Err(error) => {
            eprintln!("{error}\n{USAGE}");
            std::process::exit(2);
        }
    };
    let Some(config) = action else {
        println!("{USAGE}");
        return;
    };

    match run(config).await {
        Ok(observation) => println!("{}", observation.sanitized_json()),
        Err(error) => {
            eprintln!("experimental compatibility probe failed: {error}");
            std::process::exit(1);
        }
    }
}

fn parse_args(
    args: impl IntoIterator<Item = String>,
) -> Result<Option<CompatibilityProbeConfig>, String> {
    let mut acknowledge_live_request = false;
    let mut header_mode = None;
    let mut binding_value = None;
    let mut args = args.into_iter();

    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--acknowledge-live-request" => {
                if acknowledge_live_request {
                    return Err("duplicate --acknowledge-live-request".to_owned());
                }
                acknowledge_live_request = true;
            }
            "--mode" => {
                if header_mode.is_some() {
                    return Err("duplicate --mode".to_owned());
                }
                let value = args
                    .next()
                    .ok_or_else(|| "--mode requires a value".to_owned())?;
                header_mode = Some(match value.as_str() {
                    "with-header" => HeaderMode::WithBinding,
                    "without-header" => HeaderMode::WithoutBinding,
                    _ => return Err("--mode must be with-header or without-header".to_owned()),
                });
            }
            "--binding" => {
                if binding_value.is_some() {
                    return Err("duplicate --binding".to_owned());
                }
                binding_value = Some(
                    args.next()
                        .ok_or_else(|| "--binding requires a value".to_owned())?,
                );
            }
            "--help" | "-h" => return Ok(None),
            _ => return Err(format!("unknown argument: {argument}")),
        }
    }

    let header_mode = header_mode.ok_or_else(|| "--mode is required".to_owned())?;
    Ok(Some(CompatibilityProbeConfig {
        header_mode,
        binding_value,
        acknowledge_live_request,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn parser_requires_explicit_live_request_acknowledgement() {
        let config = parse_args(arguments(&["--mode", "without-header"]))
            .unwrap()
            .unwrap();
        assert!(!config.acknowledge_live_request);
        assert!(fusou_tlsn_verifier::experimental_compat::validate_config(&config).is_err());
    }

    #[test]
    fn parser_accepts_only_the_two_probe_modes() {
        assert!(parse_args(arguments(&[
            "--acknowledge-live-request",
            "--mode",
            "without-header",
        ]))
        .unwrap()
        .is_some());
        assert!(parse_args(arguments(&[
            "--acknowledge-live-request",
            "--mode",
            "with-header",
            "--binding",
            "binding",
        ]))
        .unwrap()
        .is_some());
        assert!(parse_args(arguments(&["--mode", "other"])).is_err());
        assert!(parse_args(arguments(&[
            "--mode",
            "without-header",
            "--host",
            "example.test"
        ]))
        .is_err());
    }

    #[test]
    fn help_does_not_construct_a_live_probe() {
        assert!(parse_args(arguments(&["--help"])).unwrap().is_none());
    }
}
