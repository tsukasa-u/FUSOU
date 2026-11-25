use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use crate::pac_operation_gate::{PacCleanupThenError, PacOperationGate, PacOperationGateError};
use proxy_https::{
    experimental_tlsn::{
        BindingPreparationDiagnostic, BindingPreparationFailureCode, CaptureReadinessDiagnostic,
        ExperimentalForwardFuture, ExperimentalRequireInfoForwarder,
        ExperimentalTlsnReadinessDiagnostic, ExperimentalTlsnRuntimeState,
    },
    proxy_server_https::ExperimentalTlsnForwarderSlot,
};

use crate::tlsn_capture_readiness::{
    CaptureReadinessStatus, IndependentObservationStatus, ReadinessStageStatus,
    TlsnCaptureReadiness,
};
use tokio::sync::oneshot;

#[derive(Default)]
struct DiagnosticCallCounts {
    freshness_requests: AtomicUsize,
    worker_health_requests: AtomicUsize,
    session_service_requests: AtomicUsize,
    device_proof_requests: AtomicUsize,
    capture_ready_checks: AtomicUsize,
    notary_admissions: AtomicUsize,
    origin_sends: AtomicUsize,
}

struct DiagnosticForwarder {
    diagnostic: ExperimentalTlsnReadinessDiagnostic,
    calls: Arc<DiagnosticCallCounts>,
}

impl ExperimentalRequireInfoForwarder for DiagnosticForwarder {
    fn forward(
        &self,
        _connection_id: u64,
        _request: http::Request<hyper::body::Bytes>,
    ) -> ExperimentalForwardFuture {
        self.calls.notary_admissions.fetch_add(1, Ordering::SeqCst);
        self.calls.origin_sends.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(None) })
    }

    fn start_preparation(&self) {
        self.calls.freshness_requests.fetch_add(1, Ordering::SeqCst);
        self.calls
            .worker_health_requests
            .fetch_add(1, Ordering::SeqCst);
        self.calls
            .session_service_requests
            .fetch_add(1, Ordering::SeqCst);
        self.calls
            .device_proof_requests
            .fetch_add(1, Ordering::SeqCst);
    }

    fn capture_ready(&self) -> bool {
        self.calls
            .capture_ready_checks
            .fetch_add(1, Ordering::SeqCst);
        true
    }

    fn readiness_diagnostic(&self) -> ExperimentalTlsnReadinessDiagnostic {
        self.diagnostic
    }
}

fn ready_readiness(
    diagnostic: ExperimentalTlsnReadinessDiagnostic,
) -> (TlsnCaptureReadiness, Arc<DiagnosticCallCounts>) {
    let (readiness, calls, attempt_id) = readiness_with_pending_pac(diagnostic);
    readiness.pac_server_started(attempt_id);
    readiness.pac_application_succeeded(attempt_id);
    (readiness, calls)
}

fn readiness_with_pending_pac(
    diagnostic: ExperimentalTlsnReadinessDiagnostic,
) -> (TlsnCaptureReadiness, Arc<DiagnosticCallCounts>, u64) {
    let readiness = TlsnCaptureReadiness::default();
    let attempt_id = readiness
        .begin_proxy(true, true, true, true)
        .expect("readiness state is available");
    readiness.proxy_listener_ready(attempt_id);
    readiness.runtime_config_verified(attempt_id);
    readiness.worker_health_verified(attempt_id);
    let calls = Arc::new(DiagnosticCallCounts::default());
    let forwarder = Arc::new(DiagnosticForwarder {
        diagnostic,
        calls: Arc::clone(&calls),
    });
    readiness.set_forwarder_slot(
        attempt_id,
        ExperimentalTlsnForwarderSlot::new(Some(forwarder)),
    );
    readiness.forwarder_initialized(attempt_id);
    (readiness, calls, attempt_id)
}

#[test]
fn repeated_readiness_reads_do_not_request_services_admit_notary_or_send_origin() {
    let (readiness, calls) = ready_readiness(ExperimentalTlsnReadinessDiagnostic {
        session_grant: BindingPreparationDiagnostic::Ready,
        capture: CaptureReadinessDiagnostic::Ready,
        execution_state: Some(ExperimentalTlsnRuntimeState::NotaryFailed),
    });

    for _ in 0..10 {
        let report = readiness.report();
        assert_eq!(report.status, CaptureReadinessStatus::Ready);
        assert_eq!(report.session_grant.status, ReadinessStageStatus::Ready);
        assert_eq!(report.capture.status, ReadinessStageStatus::Ready);
        assert_eq!(report.capture_execution_state, Some("notary_failed"));
        assert_eq!(report.pac_server.status, ReadinessStageStatus::Verified);
        assert_eq!(
            report.pac_application.status,
            ReadinessStageStatus::Verified
        );
        assert_eq!(
            report.candidate_capture.status,
            ReadinessStageStatus::Verified
        );
        assert_eq!(
            report.browser_proxy_traffic,
            IndependentObservationStatus::NotChecked
        );
        assert_eq!(
            report.notary_connection,
            IndependentObservationStatus::NotChecked
        );
        assert_eq!(
            report.observed_server_identity,
            IndependentObservationStatus::NotChecked
        );
        assert_eq!(report.evidence, IndependentObservationStatus::NotChecked);
        assert_eq!(
            report.gameplay_authorization,
            IndependentObservationStatus::NotChecked
        );
    }

    assert_eq!(calls.freshness_requests.load(Ordering::SeqCst), 0);
    assert_eq!(calls.worker_health_requests.load(Ordering::SeqCst), 0);
    assert_eq!(calls.session_service_requests.load(Ordering::SeqCst), 0);
    assert_eq!(calls.device_proof_requests.load(Ordering::SeqCst), 0);
    assert_eq!(calls.capture_ready_checks.load(Ordering::SeqCst), 0);
    assert_eq!(calls.notary_admissions.load(Ordering::SeqCst), 0);
    assert_eq!(calls.origin_sends.load(Ordering::SeqCst), 0);
}

#[test]
fn pac_cleanup_failure_or_removal_cannot_leave_readiness_ready() {
    let (unconfirmed, _) = ready_readiness(ExperimentalTlsnReadinessDiagnostic {
        session_grant: BindingPreparationDiagnostic::Ready,
        capture: CaptureReadinessDiagnostic::Ready,
        execution_state: None,
    });
    unconfirmed.pac_cleanup_unconfirmed();
    let report = unconfirmed.report();
    assert_eq!(report.status, CaptureReadinessStatus::Failed);
    assert_eq!(report.pac_application.status, ReadinessStageStatus::Failed);
    assert_eq!(report.diagnostic_code, Some("pac_cleanup_unconfirmed"));

    let (removed, _) = ready_readiness(ExperimentalTlsnReadinessDiagnostic {
        session_grant: BindingPreparationDiagnostic::Ready,
        capture: CaptureReadinessDiagnostic::Ready,
        execution_state: None,
    });
    removed.pac_application_removed();
    let report = removed.report();
    assert_eq!(report.status, CaptureReadinessStatus::Failed);
    assert_eq!(report.pac_application.status, ReadinessStageStatus::Failed);
    assert_eq!(report.diagnostic_code, Some("pac_application_removed"));
}

#[tokio::test]
async fn cleanup_waits_for_apply_and_readiness_stays_unready_through_shutdown() {
    let diagnostic = ExperimentalTlsnReadinessDiagnostic {
        session_grant: BindingPreparationDiagnostic::Ready,
        capture: CaptureReadinessDiagnostic::Ready,
        execution_state: None,
    };
    let (readiness, _, attempt_id) = readiness_with_pending_pac(diagnostic);
    readiness.pac_server_started(attempt_id);
    readiness.pac_application_succeeded(attempt_id);
    assert_eq!(readiness.report().status, CaptureReadinessStatus::Ready);

    let gate = Arc::new(PacOperationGate::new());
    let apply_guard = gate.begin_apply().await.expect("apply is allowed");
    readiness.pac_cleanup_started();
    let cleanup_pending = readiness.report();
    assert_eq!(cleanup_pending.status, CaptureReadinessStatus::Pending);
    assert_eq!(
        cleanup_pending.pac_application.status,
        ReadinessStageStatus::CleanupInProgress
    );
    assert_eq!(
        cleanup_pending.diagnostic_code,
        Some("pac_cleanup_in_progress")
    );

    readiness.pac_application_succeeded(attempt_id);
    readiness.pac_application_failed(attempt_id);
    assert_eq!(
        readiness.report().diagnostic_code,
        Some("pac_cleanup_in_progress")
    );

    let (cleanup_started_tx, cleanup_started_rx) = oneshot::channel();
    let (continue_cleanup_tx, continue_cleanup_rx) = oneshot::channel();
    let (shutdown_started_tx, shutdown_started_rx) = oneshot::channel();
    let (finish_shutdown_tx, finish_shutdown_rx) = oneshot::channel();
    let cleanup = move || async move {
        cleanup_started_tx
            .send(())
            .expect("test is waiting for cleanup to start");
        continue_cleanup_rx
            .await
            .map_err(|_| "cleanup continuation was dropped")?;
        Ok::<(), &'static str>(())
    };
    let shutdown_readiness = readiness.clone();
    let shutdown = move || async move {
        shutdown_readiness.pac_application_removed();
        shutdown_started_tx
            .send(())
            .expect("test is waiting for shutdown to start");
        finish_shutdown_rx
            .await
            .map_err(|_| "shutdown continuation was dropped")?;
        Ok::<(), &'static str>(())
    };
    let cleanup_gate = Arc::clone(&gate);
    let cleanup_task =
        tokio::spawn(async move { cleanup_gate.cleanup_then_shutdown(cleanup, shutdown).await });

    drop(apply_guard);
    cleanup_started_rx
        .await
        .expect("cleanup starts after the apply guard is released");
    assert_eq!(
        readiness.report().diagnostic_code,
        Some("pac_cleanup_in_progress")
    );
    continue_cleanup_tx
        .send(())
        .expect("cleanup is waiting to finish");
    shutdown_started_rx
        .await
        .expect("shutdown starts after cleanup succeeds");

    let removed = readiness.report();
    assert_eq!(removed.status, CaptureReadinessStatus::Failed);
    assert_eq!(removed.diagnostic_code, Some("pac_application_removed"));
    readiness.pac_application_succeeded(attempt_id);
    readiness.pac_application_failed(attempt_id);
    assert_eq!(
        readiness.report().diagnostic_code,
        Some("pac_application_removed")
    );

    finish_shutdown_tx
        .send(())
        .expect("shutdown is waiting to finish");
    assert_eq!(
        cleanup_task.await.expect("cleanup task completes"),
        Ok(Ok(()))
    );
}

#[tokio::test]
async fn failed_and_unknown_cleanup_keep_unconfirmed_readiness() {
    let diagnostic = ExperimentalTlsnReadinessDiagnostic {
        session_grant: BindingPreparationDiagnostic::Ready,
        capture: CaptureReadinessDiagnostic::Ready,
        execution_state: None,
    };
    let (failed_readiness, _, failed_attempt) = readiness_with_pending_pac(diagnostic);
    failed_readiness.pac_server_started(failed_attempt);
    failed_readiness.pac_application_succeeded(failed_attempt);
    failed_readiness.pac_cleanup_started();
    let failed_gate = PacOperationGate::new();
    let failed_result = failed_gate
        .cleanup_then_shutdown(
            || async { Err::<(), _>("pac_restore_unconfirmed") },
            || async { "unexpected shutdown" },
        )
        .await;
    assert_eq!(
        failed_result,
        Err(PacCleanupThenError::Cleanup("pac_restore_unconfirmed"))
    );
    failed_readiness.pac_cleanup_unconfirmed();
    failed_readiness.pac_application_succeeded(failed_attempt);
    failed_readiness.pac_application_failed(failed_attempt);
    assert_eq!(
        failed_readiness.report().diagnostic_code,
        Some("pac_cleanup_unconfirmed")
    );

    let (unknown_readiness, _, unknown_attempt) = readiness_with_pending_pac(diagnostic);
    unknown_readiness.pac_server_started(unknown_attempt);
    unknown_readiness.pac_application_succeeded(unknown_attempt);
    unknown_readiness.pac_cleanup_started();
    let unknown_gate = PacOperationGate::new();
    unknown_gate.mark_result_unknown();
    let unknown_result = unknown_gate
        .cleanup_then_shutdown(|| async { Ok::<(), &'static str>(()) }, || async {})
        .await;
    assert_eq!(
        unknown_result,
        Err(PacCleanupThenError::Gate(
            PacOperationGateError::PreviousResultUnknown
        ))
    );
    unknown_readiness.pac_cleanup_unconfirmed();
    unknown_readiness.pac_application_succeeded(unknown_attempt);
    unknown_readiness.pac_application_failed(unknown_attempt);
    assert_eq!(
        unknown_readiness.report().diagnostic_code,
        Some("pac_cleanup_unconfirmed")
    );
}

#[tokio::test]
async fn removed_readiness_is_recorded_before_shutdown_queue_failure() {
    let diagnostic = ExperimentalTlsnReadinessDiagnostic {
        session_grant: BindingPreparationDiagnostic::Ready,
        capture: CaptureReadinessDiagnostic::Ready,
        execution_state: None,
    };
    let (readiness, _, attempt_id) = readiness_with_pending_pac(diagnostic);
    readiness.pac_server_started(attempt_id);
    readiness.pac_application_succeeded(attempt_id);
    readiness.pac_cleanup_started();

    let gate = PacOperationGate::new();
    let shutdown_readiness = readiness.clone();
    let result = gate
        .cleanup_then_shutdown(
            || async { Ok::<(), &'static str>(()) },
            || async move {
                shutdown_readiness.pac_application_removed();
                Err::<(), _>("shutdown queue failed")
            },
        )
        .await;

    assert_eq!(result, Ok(Err("shutdown queue failed")));
    readiness.pac_application_succeeded(attempt_id);
    readiness.pac_application_failed(attempt_id);
    assert_eq!(
        readiness.report().diagnostic_code,
        Some("pac_application_removed")
    );
}

#[test]
fn shutdown_never_reports_ready_when_pac_setup_was_skipped() {
    let readiness = TlsnCaptureReadiness::default();
    let attempt_id = readiness
        .begin_proxy(true, true, true, false)
        .expect("readiness state is available");
    readiness.proxy_listener_ready(attempt_id);
    readiness.runtime_config_verified(attempt_id);
    readiness.worker_health_verified(attempt_id);
    let forwarder = Arc::new(DiagnosticForwarder {
        diagnostic: ExperimentalTlsnReadinessDiagnostic {
            session_grant: BindingPreparationDiagnostic::Ready,
            capture: CaptureReadinessDiagnostic::Ready,
            execution_state: None,
        },
        calls: Arc::new(DiagnosticCallCounts::default()),
    });
    readiness.set_forwarder_slot(
        attempt_id,
        ExperimentalTlsnForwarderSlot::new(Some(forwarder)),
    );
    readiness.forwarder_initialized(attempt_id);
    assert_eq!(readiness.report().status, CaptureReadinessStatus::Ready);

    readiness.pac_cleanup_started();

    let retry_attempt = readiness
        .begin_proxy(true, true, true, false)
        .expect("readiness state is available");
    readiness.proxy_listener_ready(retry_attempt);
    readiness.runtime_config_verified(retry_attempt);
    readiness.worker_health_verified(retry_attempt);
    let retry_forwarder = Arc::new(DiagnosticForwarder {
        diagnostic: ExperimentalTlsnReadinessDiagnostic {
            session_grant: BindingPreparationDiagnostic::Ready,
            capture: CaptureReadinessDiagnostic::Ready,
            execution_state: None,
        },
        calls: Arc::new(DiagnosticCallCounts::default()),
    });
    readiness.set_forwarder_slot(
        retry_attempt,
        ExperimentalTlsnForwarderSlot::new(Some(retry_forwarder)),
    );
    readiness.forwarder_initialized(retry_attempt);

    let cleanup_in_progress = readiness.report();
    assert_eq!(cleanup_in_progress.status, CaptureReadinessStatus::Pending);
    assert_eq!(
        cleanup_in_progress.diagnostic_code,
        Some("app_shutdown_in_progress")
    );
    assert_eq!(
        cleanup_in_progress.pac_application.status,
        ReadinessStageStatus::Skipped
    );

    readiness.pac_application_removed();
    readiness.pac_application_succeeded(retry_attempt);
    let removed = readiness.report();
    assert_eq!(removed.status, CaptureReadinessStatus::Pending);
    assert_eq!(removed.diagnostic_code, Some("app_shutdown_in_progress"));
    assert_eq!(
        removed.pac_application.status,
        ReadinessStageStatus::Skipped
    );

    readiness.pac_cleanup_unconfirmed();
    let unconfirmed = readiness.report();
    assert_eq!(unconfirmed.status, CaptureReadinessStatus::Failed);
    assert_eq!(unconfirmed.diagnostic_code, Some("pac_cleanup_unconfirmed"));
    assert_eq!(
        unconfirmed.pac_application.status,
        ReadinessStageStatus::Skipped
    );
}

#[test]
fn runtime_and_worker_failures_report_their_stage_and_safe_code() {
    let runtime_failure = TlsnCaptureReadiness::default();
    let attempt_id = runtime_failure
        .begin_proxy(true, true, true, true)
        .expect("readiness state is available");
    runtime_failure.proxy_listener_ready(attempt_id);
    runtime_failure.pac_server_started(attempt_id);
    runtime_failure.pac_application_succeeded(attempt_id);
    runtime_failure.runtime_config_failed(attempt_id);
    let runtime_report = runtime_failure.report();
    assert_eq!(runtime_report.status, CaptureReadinessStatus::Failed);
    assert_eq!(
        runtime_report.runtime_config_freshness.status,
        ReadinessStageStatus::Failed
    );
    assert_eq!(
        runtime_report.diagnostic_code,
        Some("runtime_config_freshness_verification_failed")
    );

    let worker_failure = TlsnCaptureReadiness::default();
    let attempt_id = worker_failure
        .begin_proxy(true, true, true, true)
        .expect("readiness state is available");
    worker_failure.proxy_listener_ready(attempt_id);
    worker_failure.pac_server_started(attempt_id);
    worker_failure.pac_application_succeeded(attempt_id);
    worker_failure.runtime_config_verified(attempt_id);
    worker_failure.worker_health_failed(attempt_id);
    let worker_report = worker_failure.report();
    assert_eq!(worker_report.status, CaptureReadinessStatus::Failed);
    assert_eq!(
        worker_report.worker_health.status,
        ReadinessStageStatus::Failed
    );
    assert_eq!(
        worker_report.diagnostic_code,
        Some("worker_health_verification_failed")
    );
}

#[test]
fn forwarder_initialization_pending_is_not_capture_ready() {
    let readiness = TlsnCaptureReadiness::default();
    let attempt_id = readiness
        .begin_proxy(true, true, true, true)
        .expect("readiness state is available");
    readiness.proxy_listener_ready(attempt_id);
    readiness.pac_server_started(attempt_id);
    readiness.pac_application_succeeded(attempt_id);
    readiness.runtime_config_verified(attempt_id);
    readiness.worker_health_verified(attempt_id);

    let report = readiness.report();
    assert_eq!(report.status, CaptureReadinessStatus::Pending);
    assert_eq!(
        report.forwarder_initialization.status,
        ReadinessStageStatus::Pending
    );
    assert_eq!(
        report.diagnostic_code,
        Some("forwarder_initialization_pending")
    );
    assert_ne!(report.capture.status, ReadinessStageStatus::Ready);
}

#[test]
fn expired_in_use_and_cleanup_diagnostics_never_report_ready() {
    for (diagnostic, expected_status, expected_capture_status, expected_code) in [
        (
            ExperimentalTlsnReadinessDiagnostic {
                session_grant: BindingPreparationDiagnostic::Pending,
                capture: CaptureReadinessDiagnostic::NotReady,
                execution_state: None,
            },
            CaptureReadinessStatus::Pending,
            ReadinessStageStatus::NotReady,
            Some("session_grant_preparing"),
        ),
        (
            ExperimentalTlsnReadinessDiagnostic {
                session_grant: BindingPreparationDiagnostic::Expired,
                capture: CaptureReadinessDiagnostic::NotReady,
                execution_state: None,
            },
            CaptureReadinessStatus::GrantExpired,
            ReadinessStageStatus::NotReady,
            Some("session_grant_expired"),
        ),
        (
            ExperimentalTlsnReadinessDiagnostic {
                session_grant: BindingPreparationDiagnostic::Expired,
                capture: CaptureReadinessDiagnostic::Ready,
                execution_state: None,
            },
            CaptureReadinessStatus::Unavailable,
            ReadinessStageStatus::Unavailable,
            Some("capture_readiness_inconsistent"),
        ),
        (
            ExperimentalTlsnReadinessDiagnostic {
                session_grant: BindingPreparationDiagnostic::InUse,
                capture: CaptureReadinessDiagnostic::InProgress,
                execution_state: None,
            },
            CaptureReadinessStatus::CaptureInProgress,
            ReadinessStageStatus::InProgress,
            Some("capture_in_progress"),
        ),
        (
            ExperimentalTlsnReadinessDiagnostic {
                session_grant: BindingPreparationDiagnostic::InUse,
                capture: CaptureReadinessDiagnostic::CleanupUnconfirmed,
                execution_state: None,
            },
            CaptureReadinessStatus::CleanupUnconfirmed,
            ReadinessStageStatus::CleanupUnconfirmed,
            Some("capture_cleanup_unconfirmed"),
        ),
        (
            ExperimentalTlsnReadinessDiagnostic {
                session_grant: BindingPreparationDiagnostic::Failed(
                    BindingPreparationFailureCode::RuntimeConfigChanged,
                ),
                capture: CaptureReadinessDiagnostic::NotReady,
                execution_state: None,
            },
            CaptureReadinessStatus::Failed,
            ReadinessStageStatus::NotReady,
            Some("runtime_config_changed"),
        ),
    ] {
        let (readiness, _) = ready_readiness(diagnostic);
        let report = readiness.report();
        assert_eq!(report.status, expected_status);
        assert_eq!(report.capture.status, expected_capture_status);
        assert_eq!(report.diagnostic_code, expected_code);
        assert_ne!(report.status, CaptureReadinessStatus::Ready);
        if matches!(
            diagnostic.session_grant,
            BindingPreparationDiagnostic::Failed(_)
        ) {
            assert_eq!(report.session_grant.status, ReadinessStageStatus::Failed);
            assert_eq!(
                report.session_grant.diagnostic_code,
                Some("runtime_config_changed")
            );
        }
    }
}

#[test]
fn pac_start_and_application_pending_or_failure_never_report_ready() {
    let diagnostic = ExperimentalTlsnReadinessDiagnostic {
        session_grant: BindingPreparationDiagnostic::Ready,
        capture: CaptureReadinessDiagnostic::Ready,
        execution_state: None,
    };
    let (readiness, _, attempt_id) = readiness_with_pending_pac(diagnostic);

    let pac_start_pending = readiness.report();
    assert_eq!(pac_start_pending.status, CaptureReadinessStatus::Pending);
    assert_eq!(
        pac_start_pending.pac_server.status,
        ReadinessStageStatus::Pending
    );
    assert_eq!(
        pac_start_pending.diagnostic_code,
        Some("pac_server_starting")
    );

    readiness.pac_server_failed(attempt_id);
    let pac_start_failed = readiness.report();
    assert_eq!(pac_start_failed.status, CaptureReadinessStatus::Failed);
    assert_eq!(
        pac_start_failed.pac_server.diagnostic_code,
        Some("pac_server_start_failed")
    );
    assert_ne!(pac_start_failed.status, CaptureReadinessStatus::Ready);

    readiness.pac_server_started(attempt_id);
    let pac_application_pending = readiness.report();
    assert_eq!(
        pac_application_pending.status,
        CaptureReadinessStatus::Pending
    );
    assert_eq!(
        pac_application_pending.pac_application.status,
        ReadinessStageStatus::Pending
    );
    assert_eq!(
        pac_application_pending.diagnostic_code,
        Some("pac_application_pending")
    );

    readiness.pac_application_failed(attempt_id);
    let pac_application_failed = readiness.report();
    assert_eq!(
        pac_application_failed.status,
        CaptureReadinessStatus::Failed
    );
    assert_eq!(
        pac_application_failed.pac_application.diagnostic_code,
        Some("pac_application_failed")
    );
    assert_ne!(pac_application_failed.status, CaptureReadinessStatus::Ready);

    readiness.pac_application_succeeded(attempt_id);
    let applied = readiness.report();
    assert_eq!(
        applied.pac_application.status,
        ReadinessStageStatus::Verified
    );
    assert_eq!(
        applied.browser_proxy_traffic,
        IndependentObservationStatus::NotChecked
    );
    assert_eq!(applied.status, CaptureReadinessStatus::Ready);
}

#[test]
fn candidate_capture_disabled_never_reports_ready() {
    let readiness = TlsnCaptureReadiness::default();
    let attempt_id = readiness
        .begin_proxy(true, true, false, true)
        .expect("readiness state is available");
    readiness.proxy_listener_ready(attempt_id);
    readiness.pac_server_started(attempt_id);
    readiness.pac_application_succeeded(attempt_id);
    readiness.runtime_config_verified(attempt_id);
    readiness.worker_health_verified(attempt_id);
    let calls = Arc::new(DiagnosticCallCounts::default());
    let forwarder = Arc::new(DiagnosticForwarder {
        diagnostic: ExperimentalTlsnReadinessDiagnostic {
            session_grant: BindingPreparationDiagnostic::Ready,
            capture: CaptureReadinessDiagnostic::Ready,
            execution_state: None,
        },
        calls,
    });
    readiness.set_forwarder_slot(
        attempt_id,
        ExperimentalTlsnForwarderSlot::new(Some(forwarder)),
    );
    readiness.forwarder_initialized(attempt_id);

    let report = readiness.report();
    assert_eq!(
        report.status,
        CaptureReadinessStatus::CandidateCaptureDisabled
    );
    assert_eq!(report.diagnostic_code, Some("candidate_capture_disabled"));
    assert_eq!(
        report.candidate_capture.status,
        ReadinessStageStatus::NotReady
    );
    assert_eq!(
        report.candidate_capture.diagnostic_code,
        Some("candidate_capture_disabled")
    );
}

#[test]
fn stale_proxy_attempt_results_cannot_overwrite_current_readiness() {
    let readiness = TlsnCaptureReadiness::default();
    let previous_attempt = readiness
        .begin_proxy(true, true, true, true)
        .expect("readiness state is available");
    let current_attempt = readiness
        .begin_proxy(true, true, true, true)
        .expect("readiness state is available");

    readiness.proxy_listener_ready(current_attempt);
    readiness.pac_server_started(current_attempt);
    readiness.pac_application_succeeded(current_attempt);
    readiness.runtime_config_verified(current_attempt);
    readiness.worker_health_verified(current_attempt);
    let calls = Arc::new(DiagnosticCallCounts::default());
    let forwarder = Arc::new(DiagnosticForwarder {
        diagnostic: ExperimentalTlsnReadinessDiagnostic {
            session_grant: BindingPreparationDiagnostic::Ready,
            capture: CaptureReadinessDiagnostic::Ready,
            execution_state: None,
        },
        calls,
    });
    readiness.set_forwarder_slot(
        current_attempt,
        ExperimentalTlsnForwarderSlot::new(Some(forwarder)),
    );
    readiness.forwarder_initialized(current_attempt);
    assert_eq!(readiness.report().status, CaptureReadinessStatus::Ready);

    readiness.pac_application_failed(previous_attempt);
    readiness.runtime_config_failed(previous_attempt);
    readiness.forwarder_initialization_failed(previous_attempt);
    let report = readiness.report();
    assert_eq!(report.status, CaptureReadinessStatus::Ready);
    assert_eq!(
        report.pac_application.status,
        ReadinessStageStatus::Verified
    );
    assert_eq!(
        report.runtime_config_freshness.status,
        ReadinessStageStatus::Verified
    );
    assert_eq!(
        report.forwarder_initialization.status,
        ReadinessStageStatus::Verified
    );
}
