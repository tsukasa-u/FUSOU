use super::{read_notary_attestation, spawn_exchange_task, spawn_exchange_worker};
use crate::{
    exchange_lifecycle::{ExchangeLifecycle, ExchangePolicy, NotaryAttestationLimit},
    experimental_tlsn::ProofContinuationError,
};
use std::{future::pending, time::Duration};
use tlsn::Session;
use tokio::sync::oneshot;

fn lifecycle() -> ExchangeLifecycle {
    ExchangePolicy::from_millis(Some("1000"), Some("1000"))
        .unwrap()
        .start()
        .unwrap()
}

struct DropNotice(Option<oneshot::Sender<()>>);
impl Drop for DropNotice {
    fn drop(&mut self) {
        self.0.take().unwrap().send(()).ok();
    }
}

async fn pending_task() -> (
    tokio_util::task::AbortOnDropHandle<()>,
    oneshot::Receiver<()>,
) {
    let (started, ready) = oneshot::channel();
    let (closed, observed) = oneshot::channel();
    let task = spawn_exchange_task(
        async move {
            let _owned_io = DropNotice(Some(closed));
            started.send(()).unwrap();
            pending::<()>().await;
        },
        &lifecycle(),
    );
    ready.await.unwrap();
    (task, observed)
}

#[tokio::test]
async fn early_failure_drops_both_exchange_tasks_instead_of_detaching() {
    let (driver, driver_closed) = pending_task().await;
    let (prover, prover_closed) = pending_task().await;
    let failed = async move {
        let _driver = driver;
        let _prover = prover;
        Err::<(), _>("synthetic response parse failure")
    };
    assert!(failed.await.is_err());
    tokio::time::timeout(Duration::from_secs(1), async {
        driver_closed.await.unwrap();
        prover_closed.await.unwrap();
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn cancellation_during_join_aborts_owned_task_without_touching_another_exchange() {
    let (driver, closed) = pending_task().await;
    let (other, mut other_closed) = pending_task().await;
    let waiting = tokio::spawn(async move { driver.await });
    tokio::task::yield_now().await;
    waiting.abort();
    assert!(waiting.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_secs(1), closed)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        other_closed.try_recv(),
        Err(oneshot::error::TryRecvError::Empty)
    );
    drop(other);
    tokio::time::timeout(Duration::from_secs(1), other_closed)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn successful_join_and_inner_failure_keep_the_original_result() {
    assert_eq!(
        spawn_exchange_task(async { Ok::<_, &str>(7) }, &lifecycle())
            .await
            .unwrap(),
        Ok(7)
    );
    assert_eq!(
        spawn_exchange_task(async { Err::<(), _>("prover failed") }, &lifecycle())
            .await
            .unwrap(),
        Err("prover failed")
    );
}

#[tokio::test]
async fn dropping_unrun_proof_continuation_cancels_its_owned_tasks() {
    let (driver, driver_closed) = pending_task().await;
    let (prover, prover_closed) = pending_task().await;
    let proof = crate::experimental_tlsn::ProofContinuation::new(Box::pin(async move {
        driver
            .await
            .map_err(|_| crate::experimental_tlsn::ProofContinuationError::Notary)?;
        prover
            .await
            .map_err(|_| crate::experimental_tlsn::ProofContinuationError::ProverFinalization)?;
        Ok(())
    }));
    drop(proof);
    tokio::time::timeout(Duration::from_secs(1), async {
        driver_closed.await.unwrap();
        prover_closed.await.unwrap();
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn driver_error_drops_prover_and_cleanup_observes_its_resource_destructor() {
    let lifecycle = lifecycle();
    let (closed, observed) = oneshot::channel();
    let (started, ready) = oneshot::channel();
    let prover = spawn_exchange_task(
        async move {
            let _owned_io = DropNotice(Some(closed));
            started.send(()).unwrap();
            pending::<()>().await;
        },
        &lifecycle,
    );
    ready.await.unwrap();
    let driver = spawn_exchange_task(async { Err::<(), _>("driver failed") }, &lifecycle);
    let operation = async move {
        let _prover = prover;
        driver.await.unwrap()?;
        Ok::<(), &str>(())
    };
    assert_eq!(operation.await, Err("driver failed"));
    assert!(lifecycle.wait_for_cleanup().await);
    observed.await.unwrap();
    assert!(lifecycle.tasks().is_empty());
}

#[tokio::test]
async fn dropping_inflight_exchange_aborts_and_observes_all_registered_tasks() {
    let lifecycle = lifecycle();
    let (closed, observed) = oneshot::channel();
    let (started, ready) = oneshot::channel();
    let child = spawn_exchange_task(
        async move {
            let _owned_io = DropNotice(Some(closed));
            started.send(()).unwrap();
            pending::<()>().await;
        },
        &lifecycle,
    );
    ready.await.unwrap();
    assert_eq!(lifecycle.tasks().len(), 1);
    let exchange = tokio::spawn(async move { child.await });
    exchange.abort();
    assert!(exchange.await.unwrap_err().is_cancelled());
    assert!(lifecycle.wait_for_cleanup().await);
    observed.await.unwrap();
}

#[tokio::test]
async fn successful_join_has_no_live_task_before_cleanup_confirmation() {
    let lifecycle = lifecycle();
    assert_eq!(
        spawn_exchange_task(async { 7 }, &lifecycle).await.unwrap(),
        7
    );
    assert!(lifecycle.wait_for_cleanup().await);
    assert!(lifecycle.tasks().is_empty());
    assert_eq!(lifecycle.stop_reason(), None);
}

#[tokio::test]
async fn real_session_executor_workers_are_tracked_until_shutdown_and_exit() {
    let lifecycle = lifecycle();
    let worker_lifecycle = lifecycle.clone();
    let session =
        Session::new_with_worker_spawn(futures::io::Cursor::new(Vec::<u8>::new()), move |work| {
            spawn_exchange_worker(work, &worker_lifecycle);
            Ok(())
        });
    assert!(!lifecycle.tasks().is_empty());
    drop(session);
    assert!(lifecycle.wait_for_cleanup().await);
    assert!(lifecycle.tasks().is_empty());
}

#[tokio::test]
async fn blocking_worker_timeout_cannot_be_mistaken_for_worker_exit() {
    let lifecycle = crate::exchange_lifecycle::ExchangePolicy::from_millis(Some("1000"), Some("1"))
        .unwrap()
        .start()
        .unwrap();
    let (release, wait) = std::sync::mpsc::channel();
    let (started, ready) = oneshot::channel();
    let (closed, observed) = oneshot::channel();
    spawn_exchange_worker(
        Box::new(move || {
            let _owned_io = DropNotice(Some(closed));
            started.send(()).unwrap();
            wait.recv().unwrap();
        }),
        &lifecycle,
    );
    ready.await.unwrap();
    assert!(!lifecycle.wait_for_cleanup().await);
    assert_eq!(lifecycle.tasks().len(), 1);
    release.send(()).unwrap();
    observed.await.unwrap();
    assert!(lifecycle.wait_for_cleanup().await);
}

#[tokio::test]
async fn notary_acquisition_accepts_exact_limit_and_rejects_oversize_at_one_sentinel_byte() {
    let limit = NotaryAttestationLimit::from_bytes(Some("8")).unwrap();
    let mut exact = futures::io::Cursor::new(b"12345678".to_vec());
    assert_eq!(
        read_notary_attestation(&mut exact, limit).await.unwrap(),
        b"12345678"
    );
    let mut oversized = futures::io::Cursor::new(vec![b'x'; 1024]);
    assert_eq!(
        read_notary_attestation(&mut oversized, limit)
            .await
            .unwrap_err(),
        ProofContinuationError::NotaryAttestationLimit
    );
    assert_eq!(oversized.position(), 9);
}
