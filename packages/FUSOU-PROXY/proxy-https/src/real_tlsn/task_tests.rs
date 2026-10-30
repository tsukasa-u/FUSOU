use super::spawn_exchange_task;
use std::{future::pending, time::Duration};
use tokio::sync::oneshot;

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
    let task = spawn_exchange_task(async move {
        let _owned_io = DropNotice(Some(closed));
        started.send(()).unwrap();
        pending::<()>().await;
    });
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
        spawn_exchange_task(async { Ok::<_, &str>(7) })
            .await
            .unwrap(),
        Ok(7)
    );
    assert_eq!(
        spawn_exchange_task(async { Err::<(), _>("prover failed") })
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
