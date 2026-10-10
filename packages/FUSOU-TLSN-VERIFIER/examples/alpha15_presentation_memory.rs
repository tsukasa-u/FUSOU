use std::{fs, time::Instant};

use fusou_tlsn_verifier::tlsn_alpha15::verify_alpha15_presentation;

fn status_value_kib(label: &str) -> u64 {
    fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|status| {
            status.lines().find_map(|line| {
                line.strip_prefix(label)
                    .and_then(|value| value.split_whitespace().next())
                    .and_then(|value| value.parse().ok())
            })
        })
        .unwrap_or_default()
}

fn main() {
    let presentation = include_bytes!("../fixtures/tlsn-alpha15-upstream-presentation.bin");
    let vsize_before = status_value_kib("VmSize:");
    let rss_before = status_value_kib("VmRSS:");
    let data_before = status_value_kib("VmData:");
    let hwm_before = status_value_kib("VmHWM:");
    let started = Instant::now();
    let transcript = verify_alpha15_presentation(presentation).expect("fixture verification");
    let elapsed_ms = started.elapsed().as_millis();
    let vsize_after = status_value_kib("VmSize:");
    let rss_after = status_value_kib("VmRSS:");
    let data_after = status_value_kib("VmData:");
    let hwm_after = status_value_kib("VmHWM:");
    println!(
        "presentation_bytes={} request_len={} response_len={} elapsed_ms={} vsize_before_kib={} vsize_after_kib={} vsize_delta_kib={} rss_before_kib={} rss_after_kib={} rss_delta_kib={} data_before_kib={} data_after_kib={} data_delta_kib={} hwm_before_kib={} hwm_after_kib={} hwm_delta_kib={}",
        presentation.len(),
        transcript.request_transcript_size(),
        transcript.response_transcript_size(),
        elapsed_ms,
        vsize_before,
        vsize_after,
        vsize_after.saturating_sub(vsize_before),
        rss_before,
        rss_after,
        rss_after.saturating_sub(rss_before),
        data_before,
        data_after,
        data_after.saturating_sub(data_before),
        hwm_before,
        hwm_after,
        hwm_after.saturating_sub(hwm_before),
    );
}
