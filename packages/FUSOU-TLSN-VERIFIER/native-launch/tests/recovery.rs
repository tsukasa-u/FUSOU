use super::*;
use crate::prepare::{synthetic_permit, Owner};
use std::sync::atomic::AtomicBool;

struct Fake {
    failure: Option<(Check, Reason)>,
    seen: Vec<Check>,
}
impl Observer for Fake {
    fn confirm(&mut self, check: Check) -> std::result::Result<(), Reason> {
        self.seen.push(check);
        if let Some((failed, reason)) = self.failure {
            if check == failed {
                return Err(reason);
            }
        }
        Ok(())
    }
}
#[test]
fn each_missing_os_fact_blocks_recovery_without_releasing_a_slot() {
    for (check, reason) in [
        (Check::ChildReaped, Reason::ChildNotReaped),
        (Check::LeafIdentity, Reason::LeafMismatch),
        (Check::TreeEmpty, Reason::EmptyUnknown),
        (Check::CaptureComplete, Reason::CaptureIncomplete),
        (Check::FdsClosed, Reason::FdsOpen),
        (Check::BridgeClosed, Reason::ChannelOpen),
        (Check::LeaseTerminal, Reason::LeaseNotTerminal),
        (Check::LeafRemoved, Reason::RemovalUnconfirmed),
    ] {
        let mut record = Record::quarantined(1);
        let mut fake = Fake {
            failure: Some((check, reason)),
            seen: Vec::new(),
        };
        let result = record.assess(0, &mut fake, || None).unwrap();
        assert!(matches!(
            result.status,
            Status::Quarantined | Status::AdminRequired
        ));
        assert_eq!(result.reason, Some(reason));
        assert!(!result.slot_released);
        assert_eq!(fake.seen.last(), Some(&check));
    }
}
#[test]
fn all_fake_facts_only_classify_recoverable_not_kernel_cleanup_or_release() {
    let mut record = Record::quarantined(7);
    let mut fake = Fake {
        failure: None,
        seen: Vec::new(),
    };
    let result = record.assess(0, &mut fake, || None).unwrap();
    assert_eq!(result.status, Status::Recoverable);
    assert_eq!(fake.seen, CHECKS);
    assert_eq!(result.checks_confirmed, 9);
    assert!(!result.slot_released);
    assert!(record.assess(result.revision, &mut fake, || None).is_err());
}
#[test]
fn cancelled_deadline_and_late_completion_cannot_finish_another_attempt() {
    for reason in [Reason::Cancelled, Reason::Deadline] {
        let mut record = Record::quarantined(1);
        let old = record.begin(0).unwrap();
        record.confirm(old, Check::Owner).unwrap();
        record.stop(old, reason).unwrap();
        let current = record.begin(record.snapshot().revision).unwrap();
        assert!(record.finish(old).is_err());
        assert!(record
            .confirm(
                Attempt {
                    operation_id: 2,
                    ..current
                },
                Check::Owner
            )
            .is_err());
        assert!(record.finish(current).is_err());
        assert!(record.confirm(current, Check::TreeEmpty).is_err());
        for check in CHECKS {
            record.confirm(current, check).unwrap();
        }
        record.finish(current).unwrap();
        assert!(record.finish(current).is_err());
    }
}
#[test]
fn cancellation_after_last_observation_revokes_the_attempt() {
    let mut record = Record::quarantined(1);
    let mut fake = Fake {
        failure: None,
        seen: Vec::new(),
    };
    let mut calls = 0;
    let result = record
        .assess(0, &mut fake, || {
            calls += 1;
            if calls == 18 {
                Some(Reason::Cancelled)
            } else {
                None
            }
        })
        .unwrap();
    assert_eq!(result.reason, Some(Reason::Cancelled));
    assert_eq!(result.status, Status::Quarantined);
    assert!(!result.slot_released);
}
#[test]
fn real_controller_recheck_is_owner_bound_and_requires_external_reconstruction() {
    let controller = crate::ipc_peer::controller();
    let mut lease = controller.begin(&synthetic_permit()).unwrap();
    let owner = Owner::of(&lease);
    assert!(controller.inspect_quarantine(&owner).is_err());
    lease.cleanup_pending = true;
    lease.finish(false).unwrap();
    let snapshot = controller.inspect_quarantine(&owner).unwrap();
    let other = crate::ipc_peer::controller();
    let foreign = other.begin(&synthetic_permit()).unwrap();
    assert!(controller.inspect_quarantine(&Owner::of(&foreign)).is_err());
    assert!(controller
        .recheck_quarantine(&owner, snapshot.revision + 1, &AtomicBool::new(false))
        .is_err());
    let result = controller
        .recheck_quarantine(&owner, snapshot.revision, &AtomicBool::new(false))
        .unwrap();
    assert_eq!(result.operation_id, lease.id);
    assert_eq!(result.status, Status::AdminRequired);
    assert_eq!(result.reason, Some(Reason::OwnedRecordIncomplete));
    assert!(!result.slot_released);
    assert!(controller
        .recheck_quarantine(&owner, result.revision, &AtomicBool::new(false))
        .is_err());
    assert!(lease.finish(true).is_err());
    assert!(controller.begin(&synthetic_permit()).is_err());
    let state = controller.state.lock().unwrap();
    assert_eq!((state.active, state.quarantined), (1, 1));
}
#[test]
fn old_settled_lease_cannot_target_a_new_operation_and_exhaustion_is_not_refunded() {
    let controller = crate::ipc_peer::controller();
    let mut old = controller.begin(&synthetic_permit()).unwrap();
    let old_owner = Owner::of(&old);
    old.finish(true).unwrap();
    let mut current = controller.begin(&synthetic_permit()).unwrap();
    let owner = Owner::of(&current);
    current.finish(false).unwrap();
    assert!(controller.inspect_quarantine(&old_owner).is_err());
    controller
        .charge(crate::prepare::Stage::Cleanup, controller.limits.max_work)
        .unwrap();
    assert!(controller
        .recheck_quarantine(&owner, 0, &AtomicBool::new(false))
        .is_err());
    assert_eq!(
        controller.inspect_quarantine(&owner).unwrap().status,
        Status::Quarantined
    );
    assert_eq!(controller.state.lock().unwrap().active, 1);
}
#[test]
fn dropped_failed_lease_records_identity_and_cancelled_recheck_stays_quarantined() {
    let controller = crate::ipc_peer::controller();
    let mut lease = controller.begin(&synthetic_permit()).unwrap();
    let owner = Owner::of(&lease);
    lease.cleanup_pending = true;
    drop(lease);
    let result = controller
        .recheck_quarantine(&owner, 0, &AtomicBool::new(true))
        .unwrap();
    assert_eq!(result.reason, Some(Reason::Cancelled));
    assert_eq!(result.status, Status::Quarantined);
    assert!(controller.begin(&synthetic_permit()).is_err());
}

#[test]
fn concurrent_attempts_share_one_epoch_and_never_release_on_cancel_or_completion() {
    for cancelled in [false, true] {
        let controller = crate::ipc_peer::controller();
        let mut lease = controller.begin(&synthetic_permit()).unwrap();
        let owner = Owner::of(&lease);
        lease.finish(false).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let results = std::thread::scope(|scope| {
            let first = scope.spawn(|| {
                barrier.wait();
                controller.recheck_quarantine(&owner, 0, &AtomicBool::new(cancelled))
            });
            let second = scope.spawn(|| {
                barrier.wait();
                controller.recheck_quarantine(&owner, 0, &AtomicBool::new(cancelled))
            });
            [first.join().unwrap(), second.join().unwrap()]
        });
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert!(
            !results
                .into_iter()
                .find_map(|result| result.ok())
                .unwrap()
                .slot_released
        );
        let state = controller.state.lock().unwrap();
        assert_eq!((state.active, state.quarantined), (1, 1));
    }
}
