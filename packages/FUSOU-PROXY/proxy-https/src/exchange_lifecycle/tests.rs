use super::*;
use std::future::{pending, ready};
use tokio::sync::oneshot;

fn lifecycle(exchange: &str, cleanup: &str) -> ExchangeLifecycle {
    ExchangePolicy::from_millis(Some(exchange), Some(cleanup))
        .unwrap()
        .start()
        .unwrap()
}

#[test]
fn explicit_policy_rejects_missing_noncanonical_zero_and_overflow_without_defaults() {
    assert!(ExchangePolicy::from_millis(None, Some("1")).is_err());
    assert!(ExchangePolicy::from_millis(Some("1"), None).is_err());
    for invalid in [
        "",
        "0",
        "00",
        "01",
        "-1",
        "+1",
        " 1",
        "1.5",
        "18446744073709551616",
    ] {
        assert!(ExchangePolicy::from_millis(Some(invalid), Some("1")).is_err());
        assert!(ExchangePolicy::from_millis(Some("1"), Some(invalid)).is_err());
        assert!(NotaryAttestationLimit::from_bytes(Some(invalid)).is_err());
    }
    assert!(NotaryAttestationLimit::from_bytes(None).is_err());
    assert!(NotaryAttestationLimit::from_bytes(Some("18446744073709551615")).is_err());
    assert_eq!(
        NotaryAttestationLimit::from_bytes(Some("8"))
            .unwrap()
            .max_bytes(),
        8
    );
}

#[tokio::test]
async fn phases_share_one_absolute_deadline_and_expired_ready_output_is_rejected() {
    let lifecycle = lifecycle("10", "1000");
    let deadline = lifecycle.deadline;
    assert_eq!(lifecycle.run(ready(7)).await, Ok(7));
    assert_eq!(lifecycle.deadline, deadline);
    assert_eq!(
        lifecycle.run(pending::<()>()).await,
        Err(ExchangeStop::Deadline)
    );
    assert_eq!(lifecycle.run(ready(8)).await, Err(ExchangeStop::Deadline));
}

#[tokio::test]
async fn synchronous_phase_finishing_after_deadline_cannot_report_success() {
    let lifecycle = lifecycle("1", "1000");
    assert_eq!(
        lifecycle
            .run(async {
                std::thread::sleep(Duration::from_millis(5));
                7
            })
            .await,
        Err(ExchangeStop::Deadline)
    );
}

#[test]
fn first_stop_reason_is_stable_across_cancel_deadline_races() {
    let cancelled = lifecycle("1000", "1000");
    assert_eq!(
        cancelled.stop(ExchangeStop::Cancelled),
        ExchangeStop::Cancelled
    );
    assert_eq!(
        cancelled.stop(ExchangeStop::Deadline),
        ExchangeStop::Cancelled
    );
    let timed_out = lifecycle("1000", "1000");
    assert_eq!(
        timed_out.stop(ExchangeStop::Deadline),
        ExchangeStop::Deadline
    );
    assert_eq!(
        timed_out.stop(ExchangeStop::Cancelled),
        ExchangeStop::Deadline
    );

    let raced = lifecycle("1000", "1000");
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let first = raced.clone();
    let second = raced.clone();
    let second_barrier = Arc::clone(&barrier);
    let cancel = std::thread::spawn(move || {
        barrier.wait();
        first.stop(ExchangeStop::Cancelled)
    });
    let deadline = std::thread::spawn(move || {
        second_barrier.wait();
        second.stop(ExchangeStop::Deadline)
    });
    let winner = cancel.join().unwrap();
    assert_eq!(deadline.join().unwrap(), winner);
    assert_eq!(raced.stop_reason(), Some(winner));
}

#[tokio::test]
async fn cancellation_interrupts_wait_without_polling_the_next_phase() {
    let lifecycle = lifecycle("1000", "1000");
    lifecycle.stop(ExchangeStop::Cancelled);
    assert_eq!(
        lifecycle
            .run(async { panic!("cancelled phase must not be polled") })
            .await,
        Err(ExchangeStop::Cancelled)
    );
}

#[tokio::test]
async fn cleanup_timeout_does_not_claim_task_exit_and_later_join_is_observable() {
    let lifecycle = lifecycle("1000", "5");
    let (started, ready) = oneshot::channel();
    let task = lifecycle.tasks().spawn(async move {
        started.send(()).unwrap();
        pending::<()>().await;
    });
    ready.await.unwrap();
    assert!(!lifecycle.wait_for_cleanup().await);
    assert_eq!(lifecycle.tasks().len(), 1);
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(lifecycle.wait_for_cleanup().await);
    assert!(lifecycle.tasks().is_empty());
}

#[tokio::test]
async fn cancellation_drains_admitted_local_io_instead_of_dropping_its_completion_owner() {
    let lifecycle = lifecycle("1000", "1");
    let operation = lifecycle.clone();
    let (release, wait) = oneshot::channel();
    let (started, ready) = oneshot::channel();
    let (closed, observed) = oneshot::channel();
    let caller = tokio::spawn(async move {
        operation
            .run(operation.finish_local_io(async move {
                started.send(()).unwrap();
                wait.await.unwrap();
                closed.send(()).unwrap();
                Ok::<_, ()>(())
            }))
            .await
    });
    ready.await.unwrap();
    lifecycle.stop(ExchangeStop::Cancelled);
    assert_eq!(caller.await.unwrap(), Err(ExchangeStop::Cancelled));
    assert!(!lifecycle.wait_for_cleanup().await);
    assert_eq!(lifecycle.tasks().len(), 1);
    release.send(()).unwrap();
    observed.await.unwrap();
    assert!(lifecycle.wait_for_cleanup().await);
}
