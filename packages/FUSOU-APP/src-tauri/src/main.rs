#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
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
