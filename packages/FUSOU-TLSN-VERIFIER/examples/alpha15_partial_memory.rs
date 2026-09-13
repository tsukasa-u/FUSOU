use std::{env, fs};
use tlsn_core::transcript::PartialTranscript;

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

fn memory_snapshot() -> (u64, u64, u64, u64) {
    (
        status_value_kib("VmSize:"),
        status_value_kib("VmRSS:"),
        status_value_kib("VmData:"),
        status_value_kib("VmHWM:"),
    )
}

fn main() {
    let size = env::args()
        .nth(1)
        .expect("usage: alpha15_partial_memory <bytes>")
        .parse::<usize>()
        .expect("size must be an integer");
    let (vsize_before, rss_before, data_before, hwm_before) = memory_snapshot();
    let transcript = PartialTranscript::new(size, size);
    let touched = transcript
        .sent_unsafe()
        .iter()
        .chain(transcript.received_unsafe())
        .fold(0_u8, |sum, byte| sum.wrapping_add(*byte));
    let (vsize_after, rss_after, data_after, hwm_after) = memory_snapshot();
    println!(
        "requested_each_direction_bytes={size} sent_len={} received_len={} touched={touched} vsize_before_kib={vsize_before} vsize_after_kib={vsize_after} vsize_delta_kib={} rss_before_kib={rss_before} rss_after_kib={rss_after} rss_delta_kib={} data_before_kib={data_before} data_after_kib={data_after} data_delta_kib={} hwm_before_kib={hwm_before} hwm_after_kib={hwm_after} hwm_delta_kib={}",
        transcript.len_sent(),
        transcript.len_received(),
        vsize_after.saturating_sub(vsize_before),
        rss_after.saturating_sub(rss_before),
        data_after.saturating_sub(data_before),
        hwm_after.saturating_sub(hwm_before),
    );
}
