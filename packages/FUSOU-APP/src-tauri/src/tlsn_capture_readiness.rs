use std::sync::{Arc, Mutex};

use serde::Serialize;

#[cfg(feature = "tlsn-production")]
use proxy_https::{
    experimental_tlsn::{BindingPreparationDiagnostic, CaptureReadinessDiagnostic},
    proxy_server_https::ExperimentalTlsnForwarderSlot,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadinessStageStatus {
    NotStarted,
    Pending,
    Verified,
    Failed,
    Skipped,
    Ready,
    Expired,
    InUse,
    CleanupInProgress,
    NotReady,
    InProgress,
    CleanupUnconfirmed,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureReadinessStatus {
    NotStarted,
    Disabled,
    Pending,
    Failed,
    Ready,
    CandidateCaptureDisabled,
    GrantExpired,
    CaptureInProgress,
    CleanupUnconfirmed,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ReadinessStage {
    pub status: ReadinessStageStatus,
    pub diagnostic_code: Option<&'static str>,
}

impl ReadinessStage {
    const fn new(status: ReadinessStageStatus, diagnostic_code: Option<&'static str>) -> Self {
        Self {
            status,
            diagnostic_code,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IndependentObservationStatus {
    NotChecked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct TlsnCaptureReadinessReport {
    pub status: CaptureReadinessStatus,
    pub diagnostic_code: Option<&'static str>,
    pub proxy_listener: ReadinessStage,
    pub pac_server: ReadinessStage,
    pub pac_application: ReadinessStage,
    pub runtime_config_freshness: ReadinessStage,
    pub worker_health: ReadinessStage,
    pub forwarder_initialization: ReadinessStage,
    pub candidate_capture: ReadinessStage,
    pub session_grant: ReadinessStage,
    pub capture: ReadinessStage,
    pub browser_proxy_traffic: IndependentObservationStatus,
    pub notary_connection: IndependentObservationStatus,
    pub observed_server_identity: IndependentObservationStatus,
    pub evidence: IndependentObservationStatus,
    pub gameplay_authorization: IndependentObservationStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProxyMode {
    NotStarted,
    Disabled,
    Enabled,
    ProductionFeatureUnavailable,
}

#[derive(Clone)]
struct ReadinessState {
    attempt_id: u64,
    mode: ProxyMode,
    proxy_listener: ReadinessStage,
    pac_server: ReadinessStage,
    pac_application: ReadinessStage,
    runtime_config_freshness: ReadinessStage,
    worker_health: ReadinessStage,
    forwarder_initialization: ReadinessStage,
    candidate_capture: ReadinessStage,
    #[cfg(feature = "tlsn-production")]
    forwarder_slot: Option<ExperimentalTlsnForwarderSlot>,
}

impl Default for ReadinessState {
    fn default() -> Self {
        Self {
            attempt_id: 0,
            mode: ProxyMode::NotStarted,
            proxy_listener: ReadinessStage::new(
                ReadinessStageStatus::NotStarted,
                Some("proxy_not_started"),
            ),
            pac_server: ReadinessStage::new(
                ReadinessStageStatus::NotStarted,
                Some("pac_server_not_started"),
            ),
            pac_application: ReadinessStage::new(
                ReadinessStageStatus::NotStarted,
                Some("pac_application_not_started"),
            ),
            runtime_config_freshness: ReadinessStage::new(
                ReadinessStageStatus::NotStarted,
                Some("runtime_config_freshness_not_started"),
            ),
            worker_health: ReadinessStage::new(
                ReadinessStageStatus::NotStarted,
                Some("worker_health_not_started"),
            ),
            forwarder_initialization: ReadinessStage::new(
                ReadinessStageStatus::NotStarted,
                Some("forwarder_initialization_not_started"),
            ),
            candidate_capture: ReadinessStage::new(
                ReadinessStageStatus::NotStarted,
                Some("candidate_capture_not_started"),
            ),
            #[cfg(feature = "tlsn-production")]
            forwarder_slot: None,
        }
    }
}

#[derive(Clone, Default)]
pub struct TlsnCaptureReadiness {
    state: Arc<Mutex<ReadinessState>>,
}

impl TlsnCaptureReadiness {
    pub fn begin_proxy(
        &self,
        tlsn_enabled: bool,
        production_feature_available: bool,
        candidate_capture_enabled: bool,
        pac_setup_required: bool,
    ) -> Option<u64> {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(error) => {
                tracing::error!(%error, "TLSN capture readiness state is poisoned");
                return None;
            }
        };
        state.attempt_id = state.attempt_id.wrapping_add(1);
        if state.attempt_id == 0 {
            state.attempt_id = 1;
        }
        state.mode = if !tlsn_enabled {
            ProxyMode::Disabled
        } else if !production_feature_available {
            ProxyMode::ProductionFeatureUnavailable
        } else {
            ProxyMode::Enabled
        };
        state.proxy_listener = ReadinessStage::new(
            ReadinessStageStatus::Pending,
            Some("proxy_listener_starting"),
        );
        let pac_stage = if state.mode == ProxyMode::Enabled && pac_setup_required {
            ReadinessStage::new(ReadinessStageStatus::Pending, Some("pac_server_starting"))
        } else {
            ReadinessStage::new(
                ReadinessStageStatus::Skipped,
                Some("pac_setup_not_required"),
            )
        };
        state.pac_server = pac_stage;
        state.pac_application = if state.mode == ProxyMode::Enabled && pac_setup_required {
            ReadinessStage::new(
                ReadinessStageStatus::Pending,
                Some("pac_application_pending"),
            )
        } else {
            ReadinessStage::new(
                ReadinessStageStatus::Skipped,
                Some("pac_setup_not_required"),
            )
        };
        state.forwarder_initialization = match state.mode {
            ProxyMode::Enabled => ReadinessStage::new(
                ReadinessStageStatus::Pending,
                Some("forwarder_initialization_pending"),
            ),
            ProxyMode::Disabled => {
                ReadinessStage::new(ReadinessStageStatus::Skipped, Some("tlsn_capture_disabled"))
            }
            ProxyMode::ProductionFeatureUnavailable => ReadinessStage::new(
                ReadinessStageStatus::Unavailable,
                Some("tlsn_production_feature_unavailable"),
            ),
            ProxyMode::NotStarted => unreachable!(),
        };
        if state.mode == ProxyMode::Enabled {
            state.runtime_config_freshness = ReadinessStage::new(
                ReadinessStageStatus::Pending,
                Some("runtime_config_freshness_pending"),
            );
            state.worker_health =
                ReadinessStage::new(ReadinessStageStatus::Pending, Some("worker_health_pending"));
            state.candidate_capture = if candidate_capture_enabled {
                ReadinessStage::new(ReadinessStageStatus::Verified, None)
            } else {
                ReadinessStage::new(
                    ReadinessStageStatus::NotReady,
                    Some("candidate_capture_disabled"),
                )
            };
        } else {
            state.runtime_config_freshness = ReadinessStage::new(
                ReadinessStageStatus::Skipped,
                Some("tlsn_capture_not_enabled"),
            );
            state.worker_health = state.runtime_config_freshness;
            state.candidate_capture = ReadinessStage::new(
                ReadinessStageStatus::Skipped,
                Some("tlsn_capture_not_enabled"),
            );
        }
        #[cfg(feature = "tlsn-production")]
        {
            state.forwarder_slot = None;
        }
        Some(state.attempt_id)
    }

    pub fn proxy_listener_ready(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            state.proxy_listener = ReadinessStage::new(ReadinessStageStatus::Verified, None);
        });
    }

    pub fn proxy_listener_failed(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            state.proxy_listener = ReadinessStage::new(
                ReadinessStageStatus::Failed,
                Some("proxy_listener_start_failed"),
            );
        });
    }

    pub fn pac_server_started(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            if state.pac_server.status != ReadinessStageStatus::Skipped {
                state.pac_server = ReadinessStage::new(ReadinessStageStatus::Verified, None);
            }
        });
    }

    pub fn pac_server_failed(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            if state.pac_server.status != ReadinessStageStatus::Skipped {
                state.pac_server = ReadinessStage::new(
                    ReadinessStageStatus::Failed,
                    Some("pac_server_start_failed"),
                );
            }
        });
    }

    pub fn pac_application_succeeded(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            if state.pac_application.status != ReadinessStageStatus::Skipped {
                state.pac_application = ReadinessStage::new(ReadinessStageStatus::Verified, None);
            }
        });
    }

    pub fn pac_application_failed(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            if state.pac_application.status != ReadinessStageStatus::Skipped {
                state.pac_application = ReadinessStage::new(
                    ReadinessStageStatus::Failed,
                    Some("pac_application_failed"),
                );
            }
        });
    }

    pub fn runtime_config_verified(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            state.runtime_config_freshness =
                ReadinessStage::new(ReadinessStageStatus::Verified, None);
        });
    }

    pub fn runtime_config_failed(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            state.runtime_config_freshness = ReadinessStage::new(
                ReadinessStageStatus::Failed,
                Some("runtime_config_freshness_verification_failed"),
            );
        });
    }

    pub fn worker_health_verified(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            state.worker_health = ReadinessStage::new(ReadinessStageStatus::Verified, None);
        });
    }

    pub fn worker_health_failed(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            state.worker_health = ReadinessStage::new(
                ReadinessStageStatus::Failed,
                Some("worker_health_verification_failed"),
            );
        });
    }

    #[cfg(feature = "tlsn-production")]
    pub fn set_forwarder_slot(&self, attempt_id: u64, slot: ExperimentalTlsnForwarderSlot) {
        self.update_attempt(attempt_id, |state| state.forwarder_slot = Some(slot));
    }

    pub fn forwarder_initialized(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            state.forwarder_initialization =
                ReadinessStage::new(ReadinessStageStatus::Verified, None);
        });
    }

    pub fn forwarder_initialization_failed(&self, attempt_id: u64) {
        self.update_attempt(attempt_id, |state| {
            state.forwarder_initialization = ReadinessStage::new(
                ReadinessStageStatus::Failed,
                Some("forwarder_initialization_failed"),
            );
        });
    }

    pub fn report(&self) -> TlsnCaptureReadinessReport {
        let state = match self.state.lock() {
            Ok(state) => state.clone(),
            Err(error) => {
                tracing::error!(%error, "TLSN capture readiness state is poisoned");
                return unavailable_report("readiness_state_unavailable");
            }
        };
        self.report_state(state)
    }

    fn update_attempt(&self, attempt_id: u64, update: impl FnOnce(&mut ReadinessState)) {
        match self.state.lock() {
            Ok(mut state) if state.attempt_id == attempt_id => update(&mut state),
            Ok(_) => {}
            Err(error) => tracing::error!(%error, "TLSN capture readiness state is poisoned"),
        }
    }

    fn report_state(&self, state: ReadinessState) -> TlsnCaptureReadinessReport {
        let mut report = TlsnCaptureReadinessReport {
            status: CaptureReadinessStatus::Pending,
            diagnostic_code: Some("tlsn_capture_readiness_pending"),
            proxy_listener: state.proxy_listener,
            pac_server: state.pac_server,
            pac_application: state.pac_application,
            runtime_config_freshness: state.runtime_config_freshness,
            worker_health: state.worker_health,
            forwarder_initialization: state.forwarder_initialization,
            candidate_capture: state.candidate_capture,
            session_grant: ReadinessStage::new(
                ReadinessStageStatus::NotStarted,
                Some("session_grant_provider_not_installed"),
            ),
            capture: ReadinessStage::new(
                ReadinessStageStatus::NotReady,
                Some("capture_forwarder_not_installed"),
            ),
            browser_proxy_traffic: IndependentObservationStatus::NotChecked,
            notary_connection: IndependentObservationStatus::NotChecked,
            observed_server_identity: IndependentObservationStatus::NotChecked,
            evidence: IndependentObservationStatus::NotChecked,
            gameplay_authorization: IndependentObservationStatus::NotChecked,
        };

        match state.mode {
            ProxyMode::NotStarted => {
                report.status = CaptureReadinessStatus::NotStarted;
                report.diagnostic_code = Some("proxy_not_started");
                return report;
            }
            ProxyMode::Disabled => {
                report.status = CaptureReadinessStatus::Disabled;
                report.diagnostic_code = Some("tlsn_capture_disabled");
                return report;
            }
            ProxyMode::ProductionFeatureUnavailable => {
                report.status = CaptureReadinessStatus::Unavailable;
                report.diagnostic_code = Some("tlsn_production_feature_unavailable");
                return report;
            }
            ProxyMode::Enabled => {}
        }

        let startup_stages = [
            report.proxy_listener,
            report.pac_server,
            report.pac_application,
            report.runtime_config_freshness,
            report.worker_health,
            report.forwarder_initialization,
        ];
        if let Some((status, diagnostic_code)) = failed_stage(&startup_stages) {
            report.status = if status == ReadinessStageStatus::Failed {
                CaptureReadinessStatus::Failed
            } else {
                CaptureReadinessStatus::Unavailable
            };
            report.diagnostic_code = diagnostic_code;
            return report;
        }
        if let Some(diagnostic_code) = first_pending_code(&startup_stages) {
            report.status = CaptureReadinessStatus::Pending;
            report.diagnostic_code = Some(diagnostic_code);
            return report;
        }

        #[cfg(feature = "tlsn-production")]
        let diagnostic = match state.forwarder_slot.as_ref() {
            Some(slot) => match slot.readiness_diagnostic() {
                Ok(Some(diagnostic)) => diagnostic,
                Ok(None) => {
                    report.status = CaptureReadinessStatus::Pending;
                    report.diagnostic_code = Some("capture_forwarder_not_installed");
                    return report;
                }
                Err(()) => {
                    report.status = CaptureReadinessStatus::Unavailable;
                    report.diagnostic_code = Some("forwarder_state_unavailable");
                    report.forwarder_initialization = ReadinessStage::new(
                        ReadinessStageStatus::Unavailable,
                        Some("forwarder_state_unavailable"),
                    );
                    return report;
                }
            },
            None => {
                report.status = CaptureReadinessStatus::Pending;
                report.diagnostic_code = Some("capture_forwarder_not_installed");
                return report;
            }
        };

        #[cfg(feature = "tlsn-production")]
        {
            let capture_diagnostic = if diagnostic.capture == CaptureReadinessDiagnostic::Ready
                && diagnostic.session_grant != BindingPreparationDiagnostic::Ready
            {
                CaptureReadinessDiagnostic::Unavailable
            } else {
                diagnostic.capture
            };
            report.session_grant = binding_stage(diagnostic.session_grant);
            report.capture = capture_stage(capture_diagnostic);
            report.status = overall_capture_status(diagnostic.session_grant, capture_diagnostic);
            report.diagnostic_code = if capture_diagnostic != diagnostic.capture {
                Some("capture_readiness_inconsistent")
            } else {
                overall_diagnostic_code(diagnostic.session_grant, capture_diagnostic)
            };
        }

        if report.candidate_capture.status != ReadinessStageStatus::Verified {
            report.status = CaptureReadinessStatus::CandidateCaptureDisabled;
            report.diagnostic_code = Some("candidate_capture_disabled");
        }

        #[cfg(not(feature = "tlsn-production"))]
        {
            report.status = CaptureReadinessStatus::Unavailable;
            report.diagnostic_code = Some("tlsn_production_feature_unavailable");
        }
        report
    }
}

#[cfg(feature = "tlsn-production")]
fn binding_stage(diagnostic: BindingPreparationDiagnostic) -> ReadinessStage {
    match diagnostic {
        BindingPreparationDiagnostic::Unavailable => ReadinessStage::new(
            ReadinessStageStatus::Unavailable,
            Some("session_grant_state_unavailable"),
        ),
        BindingPreparationDiagnostic::Pending => ReadinessStage::new(
            ReadinessStageStatus::Pending,
            Some("session_grant_preparing"),
        ),
        BindingPreparationDiagnostic::Ready => {
            ReadinessStage::new(ReadinessStageStatus::Ready, None)
        }
        BindingPreparationDiagnostic::Expired => {
            ReadinessStage::new(ReadinessStageStatus::Expired, Some("session_grant_expired"))
        }
        BindingPreparationDiagnostic::InUse => {
            ReadinessStage::new(ReadinessStageStatus::InUse, Some("capture_in_progress"))
        }
        BindingPreparationDiagnostic::CleanupInProgress => ReadinessStage::new(
            ReadinessStageStatus::CleanupInProgress,
            Some("session_context_cleanup_in_progress"),
        ),
        BindingPreparationDiagnostic::Failed(failure) => ReadinessStage::new(
            ReadinessStageStatus::Failed,
            Some(failure.diagnostic_code()),
        ),
    }
}

#[cfg(feature = "tlsn-production")]
fn capture_stage(diagnostic: CaptureReadinessDiagnostic) -> ReadinessStage {
    match diagnostic {
        CaptureReadinessDiagnostic::NotReady => {
            ReadinessStage::new(ReadinessStageStatus::NotReady, Some("capture_not_ready"))
        }
        CaptureReadinessDiagnostic::Ready => ReadinessStage::new(ReadinessStageStatus::Ready, None),
        CaptureReadinessDiagnostic::InProgress => ReadinessStage::new(
            ReadinessStageStatus::InProgress,
            Some("capture_in_progress"),
        ),
        CaptureReadinessDiagnostic::CleanupUnconfirmed => ReadinessStage::new(
            ReadinessStageStatus::CleanupUnconfirmed,
            Some("capture_cleanup_unconfirmed"),
        ),
        CaptureReadinessDiagnostic::Unavailable => ReadinessStage::new(
            ReadinessStageStatus::Unavailable,
            Some("capture_state_unavailable"),
        ),
    }
}

#[cfg(feature = "tlsn-production")]
fn overall_capture_status(
    grant: BindingPreparationDiagnostic,
    capture: CaptureReadinessDiagnostic,
) -> CaptureReadinessStatus {
    match capture {
        CaptureReadinessDiagnostic::CleanupUnconfirmed => {
            CaptureReadinessStatus::CleanupUnconfirmed
        }
        CaptureReadinessDiagnostic::InProgress => CaptureReadinessStatus::CaptureInProgress,
        CaptureReadinessDiagnostic::Unavailable => CaptureReadinessStatus::Unavailable,
        CaptureReadinessDiagnostic::Ready if grant == BindingPreparationDiagnostic::Ready => {
            CaptureReadinessStatus::Ready
        }
        CaptureReadinessDiagnostic::Ready => CaptureReadinessStatus::Unavailable,
        CaptureReadinessDiagnostic::NotReady => match grant {
            BindingPreparationDiagnostic::Expired => CaptureReadinessStatus::GrantExpired,
            BindingPreparationDiagnostic::Failed(_) => CaptureReadinessStatus::Failed,
            BindingPreparationDiagnostic::Unavailable => CaptureReadinessStatus::Unavailable,
            BindingPreparationDiagnostic::InUse => CaptureReadinessStatus::CaptureInProgress,
            BindingPreparationDiagnostic::Pending
            | BindingPreparationDiagnostic::CleanupInProgress => CaptureReadinessStatus::Pending,
            BindingPreparationDiagnostic::Ready => CaptureReadinessStatus::Unavailable,
        },
    }
}

#[cfg(feature = "tlsn-production")]
fn overall_diagnostic_code(
    grant: BindingPreparationDiagnostic,
    capture: CaptureReadinessDiagnostic,
) -> Option<&'static str> {
    match capture {
        CaptureReadinessDiagnostic::CleanupUnconfirmed => Some("capture_cleanup_unconfirmed"),
        CaptureReadinessDiagnostic::InProgress => Some("capture_in_progress"),
        CaptureReadinessDiagnostic::Unavailable => Some("capture_state_unavailable"),
        CaptureReadinessDiagnostic::Ready if grant == BindingPreparationDiagnostic::Ready => None,
        CaptureReadinessDiagnostic::Ready => Some("capture_readiness_inconsistent"),
        CaptureReadinessDiagnostic::NotReady => match grant {
            BindingPreparationDiagnostic::Expired => Some("session_grant_expired"),
            BindingPreparationDiagnostic::Failed(failure) => Some(failure.diagnostic_code()),
            BindingPreparationDiagnostic::Unavailable => Some("session_grant_state_unavailable"),
            BindingPreparationDiagnostic::InUse => Some("capture_in_progress"),
            BindingPreparationDiagnostic::Pending => Some("session_grant_preparing"),
            BindingPreparationDiagnostic::Ready => Some("capture_readiness_inconsistent"),
            BindingPreparationDiagnostic::CleanupInProgress => {
                Some("session_context_cleanup_in_progress")
            }
        },
    }
}

fn failed_stage(stages: &[ReadinessStage]) -> Option<(ReadinessStageStatus, Option<&'static str>)> {
    stages
        .iter()
        .find(|stage| {
            matches!(
                stage.status,
                ReadinessStageStatus::Failed | ReadinessStageStatus::Unavailable
            )
        })
        .map(|stage| (stage.status, stage.diagnostic_code))
}

fn first_pending_code(stages: &[ReadinessStage]) -> Option<&'static str> {
    stages
        .iter()
        .find(|stage| {
            !matches!(
                stage.status,
                ReadinessStageStatus::Verified | ReadinessStageStatus::Skipped
            )
        })
        .and_then(|stage| stage.diagnostic_code)
}

fn unavailable_report(code: &'static str) -> TlsnCaptureReadinessReport {
    let unavailable = ReadinessStage::new(ReadinessStageStatus::Unavailable, Some(code));
    TlsnCaptureReadinessReport {
        status: CaptureReadinessStatus::Unavailable,
        diagnostic_code: Some(code),
        proxy_listener: unavailable,
        pac_server: unavailable,
        pac_application: unavailable,
        runtime_config_freshness: unavailable,
        worker_health: unavailable,
        forwarder_initialization: unavailable,
        candidate_capture: unavailable,
        session_grant: unavailable,
        capture: unavailable,
        browser_proxy_traffic: IndependentObservationStatus::NotChecked,
        notary_connection: IndependentObservationStatus::NotChecked,
        observed_server_identity: IndependentObservationStatus::NotChecked,
        evidence: IndependentObservationStatus::NotChecked,
        gameplay_authorization: IndependentObservationStatus::NotChecked,
    }
}
