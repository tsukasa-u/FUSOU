use crate::{LaunchError, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Status {
    Quarantined,
    Checking,
    Recoverable,
    AdminRequired,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Check {
    Owner,
    ChildReaped,
    LeafIdentity,
    TreeEmpty,
    CaptureComplete,
    FdsClosed,
    BridgeClosed,
    LeaseTerminal,
    LeafRemoved,
}
const CHECKS: [Check; 9] = [
    Check::Owner,
    Check::ChildReaped,
    Check::LeafIdentity,
    Check::TreeEmpty,
    Check::CaptureComplete,
    Check::FdsClosed,
    Check::BridgeClosed,
    Check::LeaseTerminal,
    Check::LeafRemoved,
];
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Reason {
    OwnedRecordIncomplete,
    ChildNotReaped,
    LeafMismatch,
    EmptyUnknown,
    CaptureIncomplete,
    FdsOpen,
    ChannelOpen,
    LeaseNotTerminal,
    RemovalUnconfirmed,
    Cancelled,
    Deadline,
}
#[derive(Clone, Debug)]
pub(crate) struct Snapshot {
    pub operation_id: u64,
    pub revision: u64,
    pub status: Status,
    pub reason: Option<Reason>,
    pub checks_confirmed: usize,
    pub slot_released: bool,
}
#[derive(Debug)]
pub(crate) struct Record {
    operation_id: u64,
    revision: u64,
    status: Status,
    reason: Option<Reason>,
    checks: usize,
}
#[derive(Clone, Copy)]
struct Attempt {
    operation_id: u64,
    revision: u64,
}
trait Observer {
    fn confirm(&mut self, check: Check) -> std::result::Result<(), Reason>;
}
struct MissingOwnedRecord;
impl Observer for MissingOwnedRecord {
    fn confirm(&mut self, check: Check) -> std::result::Result<(), Reason> {
        if check == Check::Owner {
            Ok(())
        } else {
            Err(Reason::OwnedRecordIncomplete)
        }
    }
}
impl Record {
    pub fn quarantined(operation_id: u64) -> Self {
        Self {
            operation_id,
            revision: 0,
            status: Status::Quarantined,
            reason: Some(Reason::OwnedRecordIncomplete),
            checks: 0,
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            operation_id: self.operation_id,
            revision: self.revision,
            status: self.status,
            reason: self.reason,
            checks_confirmed: self.checks,
            slot_released: false,
        }
    }
    pub fn require_recheck(&self, revision: u64) -> Result<()> {
        if revision != self.revision {
            return Err(LaunchError::Invalid("stale recovery revision"));
        }
        if self.status != Status::Quarantined {
            return Err(LaunchError::Invalid("recovery state not recheckable"));
        }
        Ok(())
    }
    fn begin(&mut self, revision: u64) -> Result<Attempt> {
        self.require_recheck(revision)?;
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(LaunchError::Invalid("recovery revision overflow"))?;
        self.status = Status::Checking;
        self.checks = 0;
        self.reason = None;
        Ok(Attempt {
            operation_id: self.operation_id,
            revision: self.revision,
        })
    }
    fn require_attempt(&self, attempt: Attempt) -> Result<()> {
        if attempt.operation_id != self.operation_id
            || attempt.revision != self.revision
            || self.status != Status::Checking
        {
            return Err(LaunchError::Invalid("stale/duplicate recovery attempt"));
        }
        Ok(())
    }
    fn confirm(&mut self, attempt: Attempt, check: Check) -> Result<()> {
        self.require_attempt(attempt)?;
        if CHECKS.get(self.checks) != Some(&check) {
            return Err(LaunchError::Invalid("recovery check order"));
        }
        self.checks += 1;
        Ok(())
    }
    fn stop(&mut self, attempt: Attempt, reason: Reason) -> Result<()> {
        self.require_attempt(attempt)?;
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(LaunchError::Invalid("recovery revision overflow"))?;
        self.reason = Some(reason);
        self.status = if matches!(reason, Reason::OwnedRecordIncomplete | Reason::LeafMismatch) {
            Status::AdminRequired
        } else {
            Status::Quarantined
        };
        Ok(())
    }
    fn finish(&mut self, attempt: Attempt) -> Result<()> {
        self.require_attempt(attempt)?;
        if self.checks != CHECKS.len() {
            return Err(LaunchError::Invalid("recovery checks incomplete"));
        }
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(LaunchError::Invalid("recovery revision overflow"))?;
        self.status = Status::Recoverable;
        Ok(())
    }
    fn assess(
        &mut self,
        revision: u64,
        observer: &mut impl Observer,
        mut interrupted: impl FnMut() -> Option<Reason>,
    ) -> Result<Snapshot> {
        let attempt = self.begin(revision)?;
        for check in CHECKS {
            if let Some(reason) = interrupted()
                .or_else(|| observer.confirm(check).err())
                .or_else(&mut interrupted)
            {
                self.stop(attempt, reason)?;
                return Ok(self.snapshot());
            }
            self.confirm(attempt, check)?;
        }
        self.finish(attempt)?;
        Ok(self.snapshot())
    }
    // Historical quarantines do not retain a joined task/cgroup/capture/channel owner.
    // No OS facts are guessed or reacquired through a caller-supplied path/socket.
    pub fn recheck_owned_gaps(
        &mut self,
        revision: u64,
        interrupted: impl FnMut() -> Option<Reason>,
    ) -> Result<Snapshot> {
        self.assess(revision, &mut MissingOwnedRecord, interrupted)
    }
}

#[cfg(test)]
#[path = "../tests/recovery.rs"]
mod tests;
