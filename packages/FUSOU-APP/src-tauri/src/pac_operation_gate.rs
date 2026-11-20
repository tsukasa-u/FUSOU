use std::{
    future::Future,
    sync::atomic::{AtomicBool, Ordering},
};

use tokio::sync::{Mutex, MutexGuard};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PacOperationGateError {
    ShutdownRequested,
    PreviousResultUnknown,
}

impl PacOperationGateError {
    pub(crate) const fn diagnostic_code(self) -> &'static str {
        match self {
            Self::ShutdownRequested => "pac_shutdown_in_progress",
            Self::PreviousResultUnknown => "pac_operation_result_unknown",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PacCleanupThenError<E> {
    Gate(PacOperationGateError),
    Cleanup(E),
}

pub(crate) struct PacOperationGate {
    operation: Mutex<()>,
    shutdown_requested: AtomicBool,
    previous_result_unknown: AtomicBool,
}

impl PacOperationGate {
    pub(crate) const fn new() -> Self {
        Self {
            operation: Mutex::const_new(()),
            shutdown_requested: AtomicBool::new(false),
            previous_result_unknown: AtomicBool::new(false),
        }
    }

    pub(crate) async fn begin_apply(&self) -> Result<MutexGuard<'_, ()>, PacOperationGateError> {
        let guard = self.operation.lock().await;
        if self.previous_result_unknown.load(Ordering::Acquire) {
            return Err(PacOperationGateError::PreviousResultUnknown);
        }
        if self.shutdown_requested.load(Ordering::Acquire) {
            return Err(PacOperationGateError::ShutdownRequested);
        }
        Ok(guard)
    }

    pub(crate) async fn cleanup_then_shutdown<T, E, C, CFut, S, SFut>(
        &self,
        cleanup: C,
        shutdown: S,
    ) -> Result<T, PacCleanupThenError<E>>
    where
        C: FnOnce() -> CFut,
        CFut: Future<Output = Result<(), E>>,
        S: FnOnce() -> SFut,
        SFut: Future<Output = T>,
    {
        self.shutdown_requested.store(true, Ordering::Release);
        let _guard = self.operation.lock().await;
        if self.previous_result_unknown.load(Ordering::Acquire) {
            return Err(PacCleanupThenError::Gate(
                PacOperationGateError::PreviousResultUnknown,
            ));
        }
        cleanup().await.map_err(PacCleanupThenError::Cleanup)?;
        Ok(shutdown().await)
    }

    pub(crate) fn mark_result_unknown(&self) {
        self.previous_result_unknown.store(true, Ordering::Release);
    }
}

pub(crate) static PAC_OPERATION_GATE: PacOperationGate = PacOperationGate::new();

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use super::*;

    #[tokio::test]
    async fn cleanup_waits_for_apply_and_rejects_later_apply() {
        let gate = Arc::new(PacOperationGate::new());
        let apply_guard = gate
            .begin_apply()
            .await
            .expect("apply is initially allowed");
        let cleanup_gate = Arc::clone(&gate);
        let cleanup = tokio::spawn(async move {
            cleanup_gate
                .cleanup_then_shutdown(
                    || async { Ok::<(), &'static str>(()) },
                    || async { "shutdown" },
                )
                .await
        });

        tokio::task::yield_now().await;
        assert!(!cleanup.is_finished());
        drop(apply_guard);

        assert_eq!(
            cleanup.await.expect("cleanup task completes"),
            Ok("shutdown")
        );
        assert_eq!(
            gate.begin_apply().await.err(),
            Some(PacOperationGateError::ShutdownRequested)
        );
    }

    #[tokio::test]
    async fn failed_cleanup_does_not_run_shutdown_and_keeps_apply_closed() {
        let gate = PacOperationGate::new();
        let shutdown_calls = AtomicUsize::new(0);

        let result = gate
            .cleanup_then_shutdown(
                || async { Err::<(), _>("pac_restore_unconfirmed") },
                || async {
                    shutdown_calls.fetch_add(1, Ordering::SeqCst);
                },
            )
            .await;

        assert_eq!(
            result,
            Err(PacCleanupThenError::Cleanup("pac_restore_unconfirmed"))
        );
        assert_eq!(shutdown_calls.load(Ordering::SeqCst), 0);
        assert_eq!(
            gate.begin_apply().await.err(),
            Some(PacOperationGateError::ShutdownRequested)
        );
    }

    #[tokio::test]
    async fn unknown_process_result_blocks_cleanup_and_shutdown() {
        let gate = PacOperationGate::new();
        gate.mark_result_unknown();
        let operation_calls = AtomicUsize::new(0);

        let result = gate
            .cleanup_then_shutdown(
                || async {
                    operation_calls.fetch_add(1, Ordering::SeqCst);
                    Ok::<(), &'static str>(())
                },
                || async {
                    operation_calls.fetch_add(1, Ordering::SeqCst);
                },
            )
            .await;

        assert_eq!(
            result,
            Err(PacCleanupThenError::Gate(
                PacOperationGateError::PreviousResultUnknown
            ))
        );
        assert_eq!(operation_calls.load(Ordering::SeqCst), 0);
        assert_eq!(
            gate.begin_apply().await.err(),
            Some(PacOperationGateError::PreviousResultUnknown)
        );
    }
}
