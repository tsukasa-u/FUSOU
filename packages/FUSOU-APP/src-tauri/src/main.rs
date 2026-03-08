#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {

    #[cfg(target_os = "linux")]
    {
        // === Web Audio Freeze Fix for ALSA Environment ===
        
        // ✓ WebKit rendering optimizations (verified)
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        
        // ✓ GStreamer settings (verified)
        std::env::set_var("GST_DEBUG", "2");
        // Avoid demoting mpegaudioparse; doing so muted audio in some games.
        // Leave feature ranks default unless debugging decoder selection.
        std::env::set_var("WEBKIT_GST_DMABUF_SINK_DISABLED", "1");
        
        // ✓ PulseAudio settings (timing synchronization)
        // std::env::set_var("PULSE_LATENCY_MSEC", "100");
        // std::env::set_var("ALSA_CARD", "default");
        
        // Note: GStreamer uses GST_AUDIO_SINK but alsasink properties are set via element properties
        // not environment variables. Buffer/latency settings need to be configured in GStreamer pipeline.
        
        // Disable sandbox for debugging (REMOVE in production!)
        // std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
    }

    app_lib::run();
}
