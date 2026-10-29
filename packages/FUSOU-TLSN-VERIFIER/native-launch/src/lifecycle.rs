use crate::{LaunchError, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    Preparing,
    ChildCreated,
    ExecObserved,
    Capturing,
    Stopping,
    Reaped,
    TreeEmpty,
    CaptureComplete,
    CleanupConfirmed,
    Quarantined,
}
impl Phase {
    pub fn name(self) -> &'static str {
        match self {
            Self::Preparing => "PREPARING",
            Self::ChildCreated => "CHILD_CREATED",
            Self::ExecObserved => "EXEC_OBSERVED",
            Self::Capturing => "CAPTURING",
            Self::Stopping => "STOPPING",
            Self::Reaped => "REAPED",
            Self::TreeEmpty => "TREE_EMPTY",
            Self::CaptureComplete => "CAPTURE_COMPLETE",
            Self::CleanupConfirmed => "CLEANUP_CONFIRMED",
            Self::Quarantined => "QUARANTINED",
        }
    }
}
pub(crate) struct Lifecycle {
    pub phase: Phase,
    pub sequence: u32,
}
impl Lifecycle {
    pub fn new() -> Self {
        Self {
            phase: Phase::Preparing,
            sequence: 1,
        }
    }
    pub fn advance(&mut self, next: Phase) -> Result<()> {
        use Phase::*;
        let valid = matches!(
            (self.phase, next),
            (Preparing, ChildCreated)
                | (ChildCreated, ExecObserved)
                | (ExecObserved, Capturing)
                | (
                    Preparing | ChildCreated | ExecObserved | Capturing,
                    Stopping
                )
                | (Stopping, Reaped)
                | (Reaped, TreeEmpty)
                | (TreeEmpty, CaptureComplete)
                | (CaptureComplete, CleanupConfirmed)
        ) || (next == Quarantined
            && !matches!(self.phase, Quarantined | CleanupConfirmed));
        if !valid {
            if self.phase != CleanupConfirmed {
                self.phase = Quarantined;
            }
            return Err(LaunchError::Invalid("native lifecycle transition"));
        }
        self.phase = next;
        self.sequence += 1;
        Ok(())
    }
    pub fn cleanup(&mut self, mut confirm: impl FnMut(Phase) -> Result<()>) -> Result<()> {
        if !matches!(
            self.phase,
            Phase::Preparing | Phase::ChildCreated | Phase::ExecObserved | Phase::Capturing
        ) {
            return self.advance(Phase::Stopping);
        }
        for phase in [
            Phase::Stopping,
            Phase::Reaped,
            Phase::TreeEmpty,
            Phase::CaptureComplete,
            Phase::CleanupConfirmed,
        ] {
            if let Err(error) = confirm(phase) {
                self.phase = Phase::Quarantined;
                return Err(error);
            }
            self.advance(phase)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_and_failed_execution_have_distinct_cleanup_milestones() {
        let mut state = Lifecycle::new();
        for phase in [
            Phase::ChildCreated,
            Phase::ExecObserved,
            Phase::Capturing,
            Phase::Stopping,
            Phase::Reaped,
            Phase::TreeEmpty,
            Phase::CaptureComplete,
            Phase::CleanupConfirmed,
        ] {
            state.advance(phase).unwrap();
        }
        assert_eq!(state.sequence, 9);
        assert!(state.advance(Phase::CleanupConfirmed).is_err());
        assert_eq!(state.phase, Phase::CleanupConfirmed);
    }
    #[test]
    fn all_other_transitions_fail_closed() {
        use Phase::*;
        let phases = [
            Preparing,
            ChildCreated,
            ExecObserved,
            Capturing,
            Stopping,
            Reaped,
            TreeEmpty,
            CaptureComplete,
            CleanupConfirmed,
            Quarantined,
        ];
        let allowed = [
            (Preparing, ChildCreated),
            (ChildCreated, ExecObserved),
            (ExecObserved, Capturing),
            (Preparing, Stopping),
            (ChildCreated, Stopping),
            (ExecObserved, Stopping),
            (Capturing, Stopping),
            (Stopping, Reaped),
            (Reaped, TreeEmpty),
            (TreeEmpty, CaptureComplete),
            (CaptureComplete, CleanupConfirmed),
            (Preparing, Quarantined),
            (ChildCreated, Quarantined),
            (ExecObserved, Quarantined),
            (Capturing, Quarantined),
            (Stopping, Quarantined),
            (Reaped, Quarantined),
            (TreeEmpty, Quarantined),
            (CaptureComplete, Quarantined),
        ];
        for from in phases {
            for to in phases {
                let mut state = Lifecycle {
                    phase: from,
                    sequence: 1,
                };
                let result = state.advance(to);
                assert_eq!(
                    result.is_ok(),
                    allowed.contains(&(from, to)),
                    "{from:?} -> {to:?}"
                );
                if result.is_err() {
                    assert!(matches!(state.phase, Quarantined | CleanupConfirmed));
                }
            }
            if matches!(
                from,
                CleanupConfirmed | Quarantined | Stopping | Reaped | TreeEmpty | CaptureComplete
            ) {
                let mut state = Lifecycle {
                    phase: from,
                    sequence: 1,
                };
                assert!(state
                    .cleanup(|_| panic!("terminal/invalid cleanup invoked adapter"))
                    .is_err());
            }
        }
    }
    #[test]
    fn pre_child_failure_can_cleanup_but_never_claim_exec() {
        let mut state = Lifecycle::new();
        for phase in [
            Phase::Stopping,
            Phase::Reaped,
            Phase::TreeEmpty,
            Phase::CaptureComplete,
            Phase::CleanupConfirmed,
        ] {
            state.advance(phase).unwrap();
        }
        assert!(state.advance(Phase::ExecObserved).is_err());
    }
    #[test]
    fn every_cleanup_fault_quarantines_without_reaching_release() {
        for failed in [
            Phase::Stopping,
            Phase::Reaped,
            Phase::TreeEmpty,
            Phase::CaptureComplete,
            Phase::CleanupConfirmed,
        ] {
            let mut state = Lifecycle::new();
            state.advance(Phase::ChildCreated).unwrap();
            let mut visited = Vec::new();
            assert!(state
                .cleanup(|phase| {
                    visited.push(phase);
                    if phase == failed {
                        Err(LaunchError::Invalid("fake kernel cleanup failure"))
                    } else {
                        Ok(())
                    }
                })
                .is_err());
            assert_eq!(visited.last(), Some(&failed));
            assert_eq!(state.phase, Phase::Quarantined);
            assert!(state.advance(Phase::CleanupConfirmed).is_err());
        }
    }
}
