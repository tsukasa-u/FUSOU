use crate::prepare::{Arguments, Image, Input, Lease, Permit, Stage};
use crate::{sys, LaunchError, Result};
use nix::fcntl::{fcntl, FcntlArg, OFlag};
use nix::poll::{poll, PollFd, PollFlags};
use nix::sys::wait::WaitStatus;
use nix::unistd::{close, pipe2};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{AsFd, AsRawFd};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

/// No constructor: an independently admitted delegation/no-escape root does not exist.
pub(crate) struct DelegatedCgroup {
    directory: File,
    kill: File,
    events: File,
}
impl DelegatedCgroup {
    fn kill(&mut self) -> Result<()> {
        self.kill.write_all(b"1")?;
        Ok(())
    }
    fn empty(&self) -> Result<bool> {
        use std::os::unix::fs::FileExt;
        let mut raw = [0u8; 1024];
        let size = self.events.read_at(&mut raw, 0)?;
        if size == raw.len() {
            return Err(LaunchError::Invalid("cgroup events bound"));
        }
        let text = std::str::from_utf8(&raw[..size])
            .map_err(|_| LaunchError::Invalid("cgroup events encoding"))?;
        match text.lines().find(|line| line.starts_with("populated ")) {
            Some("populated 0") => Ok(true),
            Some("populated 1") => Ok(false),
            _ => Err(LaunchError::Invalid("cgroup empty unconfirmed")),
        }
    }
}
pub(crate) enum Containment {
    DirectSynthetic,
    Delegated(DelegatedCgroup),
}
pub(crate) fn require_delegated_containment() -> Result<Containment> {
    Err(LaunchError::Invalid(
        "CGROUP_DELEGATION_AND_NO_ESCAPE_NOT_REGISTERED",
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stop {
    Exited,
    Cancelled,
    Timeout,
    StdoutLimit,
    StderrLimit,
    TotalLimit,
    DrainLimit,
    ResourceLimit,
    SupervisionError,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Exit {
    Code(i32),
    Signal(i32),
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ExecReport {
    NoReportedExecError,
    Failed { stage: u32, errno: i32 },
    ProtocolFailure,
}
#[derive(Debug)]
pub(crate) struct Capture {
    pub bytes: Vec<u8>,
    pub seen: usize,
    pub sha256: [u8; 32],
    pub complete: bool,
}
#[derive(Debug)]
pub(crate) struct Observation {
    pub operation_id: u64,
    pub stop: Stop,
    pub exit: Option<Exit>,
    pub exec: ExecReport,
    pub stdout: Capture,
    pub stderr: Capture,
    pub reaped: bool,
    pub capture_eof: bool,
    pub tree_cleanup_verified: bool,
    pub slot_released: bool,
    pub fds_closed: bool,
    pub errors: Vec<String>,
}

struct Stream {
    file: File,
    bytes: Vec<u8>,
    seen: usize,
    hash: Sha256,
    eof: bool,
    discarded: bool,
    limit: usize,
}
impl Stream {
    fn new(file: File, limit: usize) -> Result<Self> {
        fcntl(&file, FcntlArg::F_SETFL(OFlag::O_NONBLOCK))?;
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(limit)
            .map_err(|_| LaunchError::Invalid("capture allocation"))?;
        Ok(Self {
            file,
            bytes,
            seen: 0,
            hash: Sha256::new(),
            eof: false,
            discarded: false,
            limit,
        })
    }
    fn drain(
        &mut self,
        total: &mut usize,
        total_limit: usize,
        lease: &Lease,
    ) -> Result<Option<Stop>> {
        if self.eof {
            return Ok(None);
        }
        lease.controller.read()?;
        let mut chunk = [0; 8192];
        let remaining_drain = lease.controller.limits.drain_bytes.saturating_sub(*total);
        if remaining_drain == 0 {
            return Ok(Some(Stop::DrainLimit));
        }
        let capacity = chunk.len().min(remaining_drain);
        let size = match self.file.read(&mut chunk[..capacity]) {
            Ok(0) => {
                self.eof = true;
                return Ok(None);
            }
            Ok(size) => size,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                ) =>
            {
                return Ok(None)
            }
            Err(error) => return Err(error.into()),
        };
        let before = *total;
        *total = total
            .checked_add(size)
            .ok_or(LaunchError::Invalid("capture count overflow"))?;
        self.seen = self
            .seen
            .checked_add(size)
            .ok_or(LaunchError::Invalid("stream count overflow"))?;
        self.hash.update(&chunk[..size]);
        let retain = size
            .min(self.limit.saturating_sub(self.bytes.len()))
            .min(total_limit.saturating_sub(before));
        self.bytes.extend_from_slice(&chunk[..retain]);
        self.discarded |= retain != size;
        if self.seen > self.limit {
            return Ok(Some(Stop::StdoutLimit));
        }
        if *total > total_limit {
            return Ok(Some(Stop::TotalLimit));
        }
        Ok(None)
    }
    fn capture(self) -> (Capture, Result<()>) {
        let closed = close(self.file).map_err(LaunchError::from);
        (
            Capture {
                bytes: self.bytes,
                seen: self.seen,
                sha256: self.hash.finalize().into(),
                complete: self.eof && !self.discarded,
            },
            closed,
        )
    }
}
fn pipe() -> Result<(File, File)> {
    let (read, write) = pipe2(OFlag::O_CLOEXEC)?;
    // Rust's owned clone uses F_DUPFD_CLOEXEC with minimum FD 3.
    Ok((
        crate::prepare::owned_above_stdio(File::from(read))?,
        crate::prepare::owned_above_stdio(File::from(write))?,
    ))
}
fn exec_report(raw: &[u8], eof: bool) -> ExecReport {
    if eof && raw.is_empty() {
        return ExecReport::NoReportedExecError;
    }
    if eof && raw.len() == 16 && &raw[..4] == b"FLX1" && raw[12..] == [0; 4] {
        let stage = u32::from_le_bytes([raw[4], raw[5], raw[6], raw[7]]);
        let errno = i32::from_le_bytes([raw[8], raw[9], raw[10], raw[11]]);
        if (1..=3).contains(&stage) && errno > 0 {
            return ExecReport::Failed { stage, errno };
        }
    }
    ExecReport::ProtocolFailure
}
pub(crate) struct Child {
    task: sys::Task,
    output: Stream,
    error_output: Stream,
    exec_pipe: Stream,
    lease: Lease,
    containment: Containment,
    started: Instant,
    setup_errors: Vec<String>,
}
pub(crate) fn launch(
    image: Image,
    input: Input,
    arguments: Arguments,
    mut lease: Lease,
    containment: Containment,
    _permit: &Permit,
) -> Result<Child> {
    image.owner.require(&lease)?;
    input.owner.require(&lease)?;
    arguments.owner.require(&lease)?;
    let limits = &lease.controller.limits;
    let capture_work = limits
        .stdout_bytes
        .checked_add(limits.stderr_bytes)
        .and_then(|n| n.checked_add(limits.drain_bytes))
        .and_then(|n| n.checked_add(8192 * 3 + 32))
        .ok_or(LaunchError::Invalid("capture reservation overflow"))?;
    lease.controller.charge(Stage::Capture, capture_work)?;
    lease.controller.charge(Stage::Fds, 12)?;
    lease.controller.charge(Stage::Cleanup, 4096)?;
    let (stdout_r, stdout_w) = pipe()?;
    let (stderr_r, stderr_w) = pipe()?;
    let (exec_r, exec_w) = pipe()?;
    let output = Stream::new(stdout_r, limits.stdout_bytes)?;
    let error_output = Stream::new(stderr_r, limits.stderr_bytes)?;
    let exec_pipe = Stream::new(exec_r, 16)?;
    let plan = sys::ChildPlan {
        image: image.file.as_raw_fd(),
        input: input.file.as_raw_fd(),
        stdout: stdout_w.as_raw_fd(),
        stderr: stderr_w.as_raw_fd(),
        error: exec_w.as_raw_fd(),
    };
    if [plan.image, plan.input, plan.stdout, plan.stderr, plan.error]
        .iter()
        .any(|fd| *fd < 3)
    {
        return Err(LaunchError::Invalid("FD plan collision"));
    }
    let group = match &containment {
        Containment::DirectSynthetic => None,
        Containment::Delegated(group) => Some(&group.directory),
    };
    let started = Instant::now();
    lease.controller.charge(Stage::Execution, 1)?;
    let task = sys::spawn(&plan, &arguments.argv, &arguments.env, group)?;
    lease.spawned = true;
    // Parent writers/image/input/argv are dropped only after clone has copied its FD/address tables.
    let mut setup_errors = Vec::with_capacity(8);
    for file in [stdout_w, stderr_w, exec_w, image.file, input.file] {
        if let Err(error) = close(file) {
            setup_errors.push(format!("parent FD close: {error}"));
        }
    }
    drop(arguments);
    Ok(Child {
        task,
        output,
        error_output,
        exec_pipe,
        lease,
        containment,
        started,
        setup_errors,
    })
}
impl Child {
    pub fn operation_id(&self) -> u64 {
        self.lease.id
    }
    #[cfg(test)]
    pub fn wait_for_exit_notification(&self) -> Result<()> {
        let mut fds = [PollFd::new(self.task.pidfd().as_fd(), PollFlags::POLLIN)];
        if poll(&mut fds, 3000u16)? == 0
            || !fds[0]
                .revents()
                .is_some_and(|events| events.contains(PollFlags::POLLIN))
        {
            return Err(LaunchError::Invalid("synthetic exit notification timeout"));
        }
        Ok(())
    }
    pub fn observe(mut self, cancel: &AtomicBool) -> Result<Observation> {
        let mut stop = Stop::Exited;
        let mut exit = None;
        let mut kill_at = None;
        let mut total = 0usize;
        let mut exec_total = 0usize;
        let parent_fds_closed = self.setup_errors.is_empty();
        let mut errors = self.setup_errors;
        if !errors.is_empty() {
            stop = Stop::SupervisionError;
            kill_at = Some(Instant::now());
        }
        let mut reaped = false;
        loop {
            let now = Instant::now();
            if kill_at.is_none() && cancel.load(Ordering::Acquire) {
                stop = Stop::Cancelled;
                kill_at = Some(now);
            }
            if kill_at.is_none()
                && now.duration_since(self.started) >= self.lease.controller.limits.timeout
            {
                stop = Stop::Timeout;
                kill_at = Some(now);
            }
            if !reaped {
                match self.task.try_reap() {
                    Ok(WaitStatus::Exited(_, code)) => {
                        exit = Some(Exit::Code(code));
                        reaped = true;
                        self.task.reaped = true;
                    }
                    Ok(WaitStatus::Signaled(_, signal, _)) => {
                        exit = Some(Exit::Signal(signal as i32));
                        reaped = true;
                        self.task.reaped = true;
                    }
                    Ok(WaitStatus::StillAlive) => {}
                    Ok(other) => {
                        errors.push(format!("unexpected wait status: {other:?}"));
                        stop = Stop::SupervisionError;
                        break;
                    }
                    Err(nix::errno::Errno::EINTR) => {}
                    Err(error) => {
                        errors.push(format!("wait: {error}"));
                        stop = Stop::SupervisionError;
                        break;
                    }
                }
            }
            if reaped {
                kill_at.get_or_insert(now);
            }
            if let Some(at) = kill_at {
                if !self.task.kill_requested {
                    let result = match &mut self.containment {
                        Containment::DirectSynthetic => sys::terminate(&self.task),
                        Containment::Delegated(group) => group.kill(),
                    };
                    if let Err(error) = result {
                        errors.push(format!("stop: {error}"));
                    }
                    self.task.kill_requested = true;
                }
                if now.duration_since(at) >= self.lease.controller.limits.cleanup_timeout {
                    break;
                }
            }
            let limit = self.lease.controller.limits.total_capture_bytes;
            let results = [
                self.output.drain(&mut total, limit, &self.lease),
                self.error_output
                    .drain(&mut total, limit, &self.lease)
                    .map(|stop| {
                        stop.map(|s| {
                            if s == Stop::StdoutLimit {
                                Stop::StderrLimit
                            } else {
                                s
                            }
                        })
                    }),
                self.exec_pipe.drain(&mut exec_total, 16, &self.lease),
            ];
            let mut resource_exhausted = false;
            for result in results {
                match result {
                    Ok(Some(reason)) => {
                        if stop == Stop::Exited {
                            stop = reason;
                        }
                        kill_at.get_or_insert(now);
                        resource_exhausted |= reason == Stop::DrainLimit;
                    }
                    Err(error) => {
                        if stop == Stop::Exited {
                            stop = Stop::ResourceLimit;
                        }
                        kill_at.get_or_insert(now);
                        if errors.len() < 8 {
                            errors.push(error.to_string());
                        }
                        resource_exhausted = true;
                    }
                    Ok(None) => {}
                }
            }
            if resource_exhausted {
                if let Err(error) = sys::terminate(&self.task) {
                    errors.push(format!("stop: {error}"));
                }
                self.task.kill_requested = true;
                // Continue wait/cleanup but do not perform further unbudgeted reads.
                while !reaped
                    && Instant::now().duration_since(kill_at.unwrap_or(now))
                        < self.lease.controller.limits.cleanup_timeout
                {
                    match self.task.try_reap() {
                        Ok(WaitStatus::Exited(_, code)) => {
                            exit = Some(Exit::Code(code));
                            reaped = true;
                            self.task.reaped = true;
                        }
                        Ok(WaitStatus::Signaled(_, signal, _)) => {
                            exit = Some(Exit::Signal(signal as i32));
                            reaped = true;
                            self.task.reaped = true;
                        }
                        Ok(WaitStatus::StillAlive) | Err(nix::errno::Errno::EINTR) => {
                            std::thread::sleep(std::time::Duration::from_millis(1))
                        }
                        other => {
                            errors.push(format!("cleanup wait: {other:?}"));
                            break;
                        }
                    }
                }
                break;
            }
            let eof = self.output.eof && self.error_output.eof && self.exec_pipe.eof;
            if reaped && eof {
                break;
            }
            let mut fds: [PollFd<'_>; 4] =
                std::array::from_fn(|_| PollFd::new(self.task.pidfd().as_fd(), PollFlags::POLLIN));
            let mut used = 0;
            for stream in [&self.output, &self.error_output, &self.exec_pipe] {
                if !stream.eof {
                    fds[used] = PollFd::new(stream.file.as_fd(), PollFlags::POLLIN);
                    used += 1;
                }
            }
            if !reaped {
                fds[used] = PollFd::new(self.task.pidfd().as_fd(), PollFlags::POLLIN);
                used += 1;
            }
            match poll(&mut fds[..used], 5u16) {
                Ok(_) | Err(nix::errno::Errno::EINTR) => {}
                Err(error) => {
                    errors.push(format!("poll: {error}"));
                    stop = Stop::SupervisionError;
                    break;
                }
            }
        }
        let capture_eof = self.output.eof && self.error_output.eof && self.exec_pipe.eof;
        let tree_empty = match &self.containment {
            Containment::DirectSynthetic => false,
            Containment::Delegated(group) => match group.empty() {
                Ok(empty) => empty,
                Err(error) => {
                    errors.push(error.to_string());
                    false
                }
            },
        };
        let exec = exec_report(&self.exec_pipe.bytes, self.exec_pipe.eof);
        let operation_id = self.lease.id;
        let (stdout, stdout_close) = self.output.capture();
        let (stderr, stderr_close) = self.error_output.capture();
        let mut fds_closed = parent_fds_closed;
        for result in [
            stdout_close,
            stderr_close,
            close(self.exec_pipe.file).map_err(LaunchError::from),
            self.task.finish(),
        ] {
            if let Err(error) = result {
                errors.push(error.to_string());
                fds_closed = false;
            }
        }
        // All stream FDs are closed before deciding whether the resource slot can settle.
        // Delegation admission and operation-directory removal are not implemented.
        // Even a readable empty event file is insufficient to release a cgroup slot.
        let containment_disposed = false;
        let cleanup_verified = reaped
            && capture_eof
            && tree_empty
            && fds_closed
            && containment_disposed
            && errors.is_empty();
        self.lease.finish(cleanup_verified)?;
        Ok(Observation {
            operation_id,
            stop,
            exit,
            exec,
            stdout,
            stderr,
            reaped,
            capture_eof,
            tree_cleanup_verified: cleanup_verified,
            slot_released: cleanup_verified,
            fds_closed,
            errors,
        })
    }
}

#[cfg(test)]
pub(crate) fn check_exec_report(raw: &[u8], eof: bool) -> ExecReport {
    exec_report(raw, eof)
}
