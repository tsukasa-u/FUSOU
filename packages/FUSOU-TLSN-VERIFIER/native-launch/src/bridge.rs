use crate::lifecycle::{Lifecycle, Phase};
use crate::prepare::{Lease, Owner};
use crate::{LaunchError, Result};
use fusou_tlsn_verifier::strict_json::{parse_json, JsonLimits};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

pub(crate) const STAGES: [&str; 7] = [
    "image",
    "input",
    "fds",
    "execution",
    "capture",
    "stop",
    "cleanup",
];
pub(crate) struct Bridge {
    stream: UnixStream,
    owner: Owner,
    operation_id: String,
    native_id: u64,
    control: Vec<u8>,
    lifecycle: Lifecycle,
    controls: usize,
}
fn parse(raw: &[u8]) -> Result<Value> {
    parse_json(
        raw,
        JsonLimits {
            max_bytes: 2048,
            max_nodes: 64,
            max_depth: 4,
            max_string_bytes: 128,
        },
    )
    .map_err(|error| LaunchError::Input(error.to_string()))
}
impl Bridge {
    pub fn accept(mut stream: UnixStream, lease: &mut Lease) -> Result<Self> {
        lease.cleanup_pending = true;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        let mut raw = Vec::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while raw.len() <= 2048 {
            let remaining = deadline
                .checked_duration_since(std::time::Instant::now())
                .ok_or(LaunchError::Invalid("bridge request deadline"))?;
            stream.set_read_timeout(Some(remaining))?;
            let mut byte = [0];
            stream.read_exact(&mut byte)?;
            raw.push(byte[0]);
            if byte[0] == b'\n' {
                break;
            }
        }

        if raw.len() > 2048 || raw.pop() != Some(b'\n') {
            return Err(LaunchError::Invalid("bridge request bound"));
        }
        let request = parse(&raw)?;
        let object = request
            .as_object()
            .ok_or(LaunchError::Invalid("bridge request shape"))?;
        if object.len() != 3 || request["action"] != "START" {
            return Err(LaunchError::Invalid("bridge START"));
        }
        let id = request["operation_id"]
            .as_str()
            .ok_or(LaunchError::Invalid("bridge ID"))?;
        if id.is_empty()
            || id.len() > 96
            || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err(LaunchError::Invalid("bridge operation ID"));
        }
        let reservation = request["reservation"]
            .as_object()
            .ok_or(LaunchError::Invalid("bridge reservation"))?;
        if reservation.len() != 9
            || reservation
                .keys()
                .any(|key| !STAGES.contains(&key.as_str()) && key != "reads" && key != "captures")
        {
            return Err(LaunchError::Invalid("bridge reservation fields"));
        }
        let number = |name: &str| -> Result<usize> {
            let value = request["reservation"][name]
                .as_u64()
                .ok_or(LaunchError::Invalid("bridge numeric reservation"))?;
            if value == 0 || value > 9_007_199_254_740_991 {
                return Err(LaunchError::Invalid("bridge numeric range"));
            }
            usize::try_from(value).map_err(|_| LaunchError::Invalid("bridge reservation overflow"))
        };
        let mut caps = [0; 7];
        for (index, key) in STAGES.iter().enumerate() {
            caps[index] = number(key)?;
        }
        if number("captures")? < 2 {
            return Err(LaunchError::Invalid("bridge capture reservation"));
        }
        {
            let mut state = lease
                .controller
                .state
                .lock()
                .map_err(|_| LaunchError::Invalid("controller poisoned"))?;
            if state.bridge_caps.is_some()
                || state.work != [0; 7]
                || state.reads != 0
                || state.active != 1
                || lease.controller.limits.max_active != 1
            {
                return Err(LaunchError::Invalid(
                    "bridge requires fresh exclusively owned controller",
                ));
            }
            state.bridge_caps = Some(caps);
            state.bridge_reads = Some(number("reads")?);
        }
        stream.set_read_timeout(None)?;
        stream.set_nonblocking(true)?;
        let mut bridge = Self {
            stream,
            owner: Owner::of(lease),
            operation_id: id.into(),
            native_id: lease.id,
            control: Vec::with_capacity(256),
            lifecycle: Lifecycle::new(),
            controls: 0,
        };
        bridge.emit(lease, "PENDING")?;
        Ok(bridge)
    }
    pub fn require_owner(&self, lease: &Lease) -> Result<()> {
        self.owner.require(lease)
    }
    fn emit(&mut self, lease: &Lease, outcome: &str) -> Result<()> {
        self.require_owner(lease)?;
        let state = lease
            .controller
            .state
            .lock()
            .map_err(|_| LaunchError::Invalid("controller poisoned"))?;
        let terminal = matches!(
            self.lifecycle.phase,
            Phase::CleanupConfirmed | Phase::Quarantined
        );
        let usage = if terminal {
            let mut value = serde_json::Map::new();
            for (index, key) in STAGES.iter().enumerate() {
                value.insert((*key).into(), json!(state.work[index]));
            }
            value.insert("reads".into(), json!(state.reads));
            value.insert("captures".into(), json!(2));
            Value::Object(value)
        } else {
            Value::Null
        };
        let mut raw = serde_json::to_vec(&json!({
            "version": 1, "operation_id": self.operation_id, "native_id": self.native_id,
            "sequence": self.lifecycle.sequence, "state": self.lifecycle.phase.name(),
            "outcome": outcome, "usage": usage,
        }))
        .map_err(|error| LaunchError::Input(error.to_string()))?;
        raw.push(b'\n');
        // A nonblocking write that cannot complete is a protocol failure, never a successful notification.
        self.stream.write_all(&raw)?;
        Ok(())
    }
    pub fn advance(&mut self, phase: Phase, lease: &Lease, outcome: &str) -> Result<()> {
        self.lifecycle.advance(phase)?;
        self.emit(lease, outcome)
    }
    pub fn cancelled(&mut self) -> Result<bool> {
        let mut bytes = [0; 256];
        match self.stream.read(&mut bytes) {
            Ok(0) => return Err(LaunchError::Invalid("bridge disconnected")),
            Ok(count) => self.control.extend_from_slice(&bytes[..count]),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => return Ok(false),
            Err(error) => return Err(error.into()),
        }
        if self.control.len() > 256 || self.controls > 0 {
            return Err(LaunchError::Invalid("bridge control bound"));
        }
        if self.control.last() != Some(&b'\n') {
            return Ok(false);
        }
        let request = parse(&self.control[..self.control.len() - 1])?;
        if request.as_object().is_none_or(|value| value.len() != 2)
            || request["operation_id"] != self.operation_id
            || request["action"] != "CANCEL"
        {
            return Err(LaunchError::Invalid("bridge cancellation identity"));
        }
        self.controls += 1;
        self.control.clear();
        Ok(true)
    }
}

#[cfg(test)]
#[path = "../tests/bridge.rs"]
mod tests;
