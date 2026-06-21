#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {

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
