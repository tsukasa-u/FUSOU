use super::*;
use crate::prepare::{synthetic_permit, Stage};
fn request(id: &str) -> Vec<u8> {
    let mut raw = serde_json::to_vec(&json!({"action": "START", "operation_id": id,
        "reservation": {"image": 4096, "input": 4096, "fds": 4096, "execution": 1,
            "capture": 4096, "stop": 4096, "cleanup": 4096, "reads": 16, "captures": 2}}))
    .unwrap();
    raw.push(b'\n');
    raw
}
#[test]
fn reservations_bind_before_native_work_and_cancellation_checks_identity() {
    for id in ["native-bound", "native-other"] {
        let controller = crate::ipc_peer::controller();
        let mut lease = controller.begin(&synthetic_permit()).unwrap();
        let (left, mut right) = UnixStream::pair().unwrap();
        right.write_all(&request("native-bound")).unwrap();
        let mut peer = Bridge::accept(left, &mut lease).unwrap();
        assert!(!peer.cancelled().unwrap());
        controller.charge(Stage::Image, 4096).unwrap();
        assert!(controller.charge(Stage::Image, 1).is_err());
        controller.reserve_reads(16).unwrap();
        assert!(controller.read().is_err());
        writeln!(right, "{}", json!({"operation_id": id, "action": "CANCEL"})).unwrap();
        if id == "native-bound" {
            assert!(peer.cancelled().unwrap());
            writeln!(right, "{}", json!({"operation_id": id, "action": "CANCEL"})).unwrap();
            assert!(peer.cancelled().is_err());
        } else {
            assert!(peer.cancelled().is_err());
        }
        drop(peer);
        drop(lease);
        assert!(controller.begin(&synthetic_permit()).is_err());
        assert_eq!(controller.state.lock().unwrap().quarantined, 1);
    }
}
#[test]
fn malformed_prelaunch_request_quarantines_instead_of_releasing() {
    for raw in [
        b"{}\n".as_slice(),
        b"{\"action\":\"START\",\"action\":\"START\"}\n",
        b"{\"x\":\"\xff\"}\n",
    ] {
        let controller = crate::ipc_peer::controller();
        let mut lease = controller.begin(&synthetic_permit()).unwrap();
        let (left, mut right) = UnixStream::pair().unwrap();
        right.write_all(raw).unwrap();
        assert!(Bridge::accept(left, &mut lease).is_err());
        drop(lease);
        assert!(controller.begin(&synthetic_permit()).is_err());
    }
}
#[test]
fn cleanup_adapter_faults_retain_slots_and_duplicate_settlement_cannot_release_another() {
    for fault in [
        "kill", "reap", "empty", "capture", "fd-close", "remove", "absence",
    ] {
        let controller = crate::ipc_peer::controller();
        let mut lease = controller.begin(&synthetic_permit()).unwrap();
        lease.cleanup_pending = true;
        let mut lifecycle = Lifecycle::new();
        let failed = match fault {
            "kill" => Phase::Stopping,
            "reap" => Phase::Reaped,
            "empty" => Phase::TreeEmpty,
            "capture" | "fd-close" => Phase::CaptureComplete,
            _ => Phase::CleanupConfirmed,
        };
        assert!(lifecycle
            .cleanup(|phase| if phase == failed {
                Err(LaunchError::Invalid("fake adapter rejects OS confirmation"))
            } else {
                Ok(())
            })
            .is_err());
        lease.finish(false).unwrap();
        assert!(lease.finish(true).is_err());
        assert!(controller.begin(&synthetic_permit()).is_err());
        assert_eq!(controller.state.lock().unwrap().quarantined, 1);
    }
    let controller = crate::ipc_peer::controller();
    let mut old = controller.begin(&synthetic_permit()).unwrap();
    let mut lifecycle = Lifecycle::new();
    lifecycle.cleanup(|_| Ok(())).unwrap();
    old.finish(true).unwrap();
    let current = controller.begin(&synthetic_permit()).unwrap();
    assert!(old.finish(true).is_err());
    assert_eq!(controller.state.lock().unwrap().active, 1);
    drop(current);
}
