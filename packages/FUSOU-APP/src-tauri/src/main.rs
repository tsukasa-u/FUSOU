#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().nth(1).as_deref()
        == Some(std::ffi::OsStr::new("--tlsn-candidate-config"))
    {
        if std::env::args_os().count() != 5
            || std::env::args_os().nth(3).as_deref()
                != Some(std::ffi::OsStr::new("--tlsn-candidate-start-marker"))
        {
            eprintln!(
                "usage: fusou --tlsn-candidate-config <path> --tlsn-candidate-start-marker <path>"
            );
            std::process::exit(2);
        }
        let Some(config_path) = std::env::args_os().nth(2).map(std::path::PathBuf::from) else {
            eprintln!("missing candidate APP config path");
            std::process::exit(2);
        };
        let Some(start_marker_path) = std::env::args_os().nth(4).map(std::path::PathBuf::from)
        else {
            eprintln!("missing candidate APP start marker path");
            std::process::exit(2);
        };
        if !config_path.is_absolute() {
            eprintln!("candidate APP config path must be absolute");
            std::process::exit(2);
        }
        if !start_marker_path.is_absolute() {
            eprintln!("candidate APP start marker path must be absolute");
            std::process::exit(2);
        }
        match std::fs::symlink_metadata(&config_path) {
            Ok(metadata) if metadata.file_type().is_file() => {}
            _ => {
                eprintln!("candidate APP config is missing or not a regular non-symlink file");
                std::process::exit(2);
            }
        }
        let Some(config_path_str) = config_path.to_str() else {
            eprintln!("candidate APP config path must be valid UTF-8");
            std::process::exit(2);
        };
        if let Err(error) = app_lib::tlsn_preflight::set_candidate_config_path(config_path.clone())
        {
            eprintln!("failed to bind candidate APP config path: {error}");
            std::process::exit(2);
        }
        if let Err(error) =
            app_lib::tlsn_preflight::set_candidate_app_start_marker(start_marker_path)
        {
            eprintln!("failed to bind candidate APP start marker: {error}");
            std::process::exit(2);
        }
        if let Err(error) = configs::set_user_config(config_path_str) {
            eprintln!("failed to load candidate APP config: {error}");
            std::process::exit(2);
        }
        let proxy = configs::get_user_configs_for_proxy();
        let preflight_config = app_lib::tlsn_preflight::TlsnPreflightConfig::from_proxy(&proxy);
        let report = app_lib::tlsn_preflight::run_candidate_pre_capture_preflight(
            &preflight_config,
            &config_path,
        );
        if !report.ready {
            eprintln!(
                "candidate APP runtime preflight failed: {}",
                report.failure_summary()
            );
            std::process::exit(1);
        }
        app_lib::run();
        return;
    }

    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--tlsn-preflight")) {
        let mut args = std::env::args_os().skip(2);
        if args.next().as_deref() != Some(std::ffi::OsStr::new("--config")) {
            eprintln!("usage: fusou --tlsn-preflight --config <path>");
            std::process::exit(2);
        }
        let Some(config_path) = args.next().map(std::path::PathBuf::from) else {
            eprintln!("missing value for --config");
            std::process::exit(2);
        };
        if args.next().is_some() {
            eprintln!("candidate pre-capture preflight accepts no additional arguments");
            std::process::exit(2);
        }
        match std::fs::symlink_metadata(&config_path) {
            Ok(metadata) if metadata.file_type().is_file() => {}
            _ => {
                eprintln!("candidate APP config is missing or not a regular file");
                std::process::exit(2);
            }
        }
        let Some(config_path_str) = config_path.to_str() else {
            eprintln!("candidate APP config path must be valid UTF-8");
            std::process::exit(2);
        };
        if let Err(error) = configs::set_user_config(config_path_str) {
            eprintln!("failed to load candidate APP config: {error}");
            std::process::exit(2);
        }
        let proxy = configs::get_user_configs_for_proxy();
        let preflight_config = app_lib::tlsn_preflight::TlsnPreflightConfig::from_proxy(&proxy);
        let report = app_lib::tlsn_preflight::run_candidate_pre_capture_preflight(
            &preflight_config,
            &config_path,
        );
        match serde_json::to_string(&report) {
            Ok(report_json) => println!("{report_json}"),
            Err(error) => {
                eprintln!("candidate APP preflight report serialization failed: {error}");
                std::process::exit(1);
            }
        }
        if !report.ready {
            std::process::exit(1);
        }
        return;
    }

    if std::env::args_os().nth(1).as_deref()
        == Some(std::ffi::OsStr::new("--tlsn-compiled-worker-entry"))
    {
        if std::env::args_os().count() != 2 {
            eprintln!("compiled Worker entry report accepts no additional arguments");
            std::process::exit(1);
        }
        match app_lib::tlsn_build_handoff::compiled_worker_entry_report()
            .and_then(|report| serde_json::to_string(&report).map_err(|error| error.to_string()))
        {
            Ok(report) => println!("{report}"),
            Err(error) => {
                eprintln!("compiled Worker entry report failed: {error}");
                std::process::exit(1);
            }
        }
        return;
    }

    if std::env::args_os().nth(1).as_deref()
        == Some(std::ffi::OsStr::new("--app-compiled-public-configuration"))
    {
        if std::env::args_os().count() != 2 {
            eprintln!("compiled APP public configuration accepts no additional arguments");
            std::process::exit(1);
        }
        match app_lib::app_public_configuration::compiled_public_configuration_report()
            .and_then(|report| serde_json::to_string(&report).map_err(|error| error.to_string()))
        {
            Ok(report) => println!("{report}"),
            Err(error) => {
                eprintln!("compiled APP public configuration failed: {error}");
                std::process::exit(1);
            }
        }
        return;
    }

    #[cfg(target_os = "linux")]
    {
        // === Web Audio Freeze Fix for ALSA Environment ===
        
        // ✓ WebKit rendering optimizations (verified)
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        // 
        // ✓ GStreamer settings (verified)
        // std::env::set_var("GST_DEBUG", "2");
        // Avoid demoting mpegaudioparse; doing so muted audio in some games.
        // Leave feature ranks default unless debugging decoder selection.
        // std::env::set_var("WEBKIT_GST_DMABUF_SINK_DISABLED", "1");

        // std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        
    }

    app_lib::run();
}
