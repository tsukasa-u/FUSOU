use crate::bridge::Bridge;
use crate::lifecycle::{Lifecycle, Phase};
use crate::prepare::{synthetic_permit, Controller, Limits};
use std::os::unix::net::UnixStream;
use std::time::Duration;

// Explicit test-harness selector, not a provider binary or an environment-minted launch permit.
pub(crate) fn controller() -> Controller {
    Controller::new(
        Limits {
            image_bytes: 32 * 1024 * 1024,
            stdout_bytes: 16384,
            stderr_bytes: 16384,
            total_capture_bytes: 32768,
            drain_bytes: 131072,
            max_work: 512 * 1024 * 1024,
            max_reads: 16384,
            max_active: 1,
            timeout: Duration::from_secs(1),
            cleanup_timeout: Duration::from_secs(1),
        },
        &synthetic_permit(),
    )
    .unwrap()
}
#[test]
fn serve() {
    let path = std::env::var_os("FUSOU_NATIVE_TEST_SOCKET").expect("explicit test socket");
    let mode = std::env::var("FUSOU_NATIVE_TEST_MODE").expect("explicit fake adapter mode");
    let permit = synthetic_permit();
    let controller = controller();
    let mut lease = controller.begin(&permit).unwrap();
    let mut peer = Bridge::accept(UnixStream::connect(path).unwrap(), &mut lease).unwrap();
    if mode == "direct" || mode == "direct-cancel" {
        crate::tests::observe_direct_bridge(lease, &mut peer, mode == "direct-cancel");
        return;
    }
    let mut lifecycle = Lifecycle::new();
    for phase in [Phase::ChildCreated, Phase::ExecObserved, Phase::Capturing] {
        lifecycle.advance(phase).unwrap();
        peer.advance(phase, &lease, "PENDING").unwrap();
    }
    if mode == "cancel" {
        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        while !peer.cancelled().unwrap() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    let cleanup = lifecycle.cleanup(|phase| {
        if mode == phase.name() {
            return Err(crate::LaunchError::Invalid("fake adapter fault"));
        }
        peer.advance(
            phase,
            &lease,
            if phase == Phase::CleanupConfirmed {
                if mode == "cancel" {
                    "FAILED"
                } else {
                    "SUCCEEDED"
                }
            } else {
                "PENDING"
            },
        )
    });
    if cleanup.is_err() {
        peer.advance(Phase::Quarantined, &lease, "FAILED").unwrap();
    }
    lease.finish(cleanup.is_ok()).unwrap();
    let state = controller.state.lock().unwrap();
    assert_eq!(state.active, usize::from(cleanup.is_err()));
    assert_eq!(state.quarantined, usize::from(cleanup.is_err()));
}
