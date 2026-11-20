use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use proxy_https::{
    experimental_tlsn::{
        BindingPreparationDiagnostic, BindingPreparationFailureCode, CaptureReadinessDiagnostic,
        ExperimentalForwardFuture, ExperimentalRequireInfoForwarder,
        ExperimentalTlsnReadinessDiagnostic,
    },
    proxy_server_https::ExperimentalTlsnForwarderSlot,
};

use crate::tlsn_capture_readiness::{
    CaptureReadinessStatus, IndependentObservationStatus, ReadinessStageStatus,
    TlsnCaptureReadiness,
};

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
    });

    for _ in 0..10 {
        let report = readiness.report();
        assert_eq!(report.status, CaptureReadinessStatus::Ready);
        assert_eq!(report.session_grant.status, ReadinessStageStatus::Ready);
        assert_eq!(report.capture.status, ReadinessStageStatus::Ready);
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
    });
    unconfirmed.pac_cleanup_unconfirmed();
    let report = unconfirmed.report();
    assert_eq!(report.status, CaptureReadinessStatus::Failed);
    assert_eq!(report.pac_application.status, ReadinessStageStatus::Failed);
    assert_eq!(report.diagnostic_code, Some("pac_cleanup_unconfirmed"));

    let (removed, _) = ready_readiness(ExperimentalTlsnReadinessDiagnostic {
        session_grant: BindingPreparationDiagnostic::Ready,
        capture: CaptureReadinessDiagnostic::Ready,
    });
    removed.pac_application_removed();
    let report = removed.report();
    assert_eq!(report.status, CaptureReadinessStatus::Failed);
    assert_eq!(report.pac_application.status, ReadinessStageStatus::Failed);
    assert_eq!(report.diagnostic_code, Some("pac_application_removed"));
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
            },
            CaptureReadinessStatus::Pending,
            ReadinessStageStatus::NotReady,
            Some("session_grant_preparing"),
        ),
        (
            ExperimentalTlsnReadinessDiagnostic {
                session_grant: BindingPreparationDiagnostic::Expired,
                capture: CaptureReadinessDiagnostic::NotReady,
            },
            CaptureReadinessStatus::GrantExpired,
            ReadinessStageStatus::NotReady,
            Some("session_grant_expired"),
        ),
        (
            ExperimentalTlsnReadinessDiagnostic {
                session_grant: BindingPreparationDiagnostic::Expired,
                capture: CaptureReadinessDiagnostic::Ready,
            },
            CaptureReadinessStatus::Unavailable,
            ReadinessStageStatus::Unavailable,
            Some("capture_readiness_inconsistent"),
        ),
        (
            ExperimentalTlsnReadinessDiagnostic {
                session_grant: BindingPreparationDiagnostic::InUse,
                capture: CaptureReadinessDiagnostic::InProgress,
            },
            CaptureReadinessStatus::CaptureInProgress,
            ReadinessStageStatus::InProgress,
            Some("capture_in_progress"),
        ),
        (
            ExperimentalTlsnReadinessDiagnostic {
                session_grant: BindingPreparationDiagnostic::InUse,
                capture: CaptureReadinessDiagnostic::CleanupUnconfirmed,
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
