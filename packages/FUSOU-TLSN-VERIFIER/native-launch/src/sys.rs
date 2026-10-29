use crate::{LaunchError, Result};
use std::ffi::CString;
use std::fs::File;
use std::io;
use std::os::fd::{AsFd, AsRawFd, FromRawFd, RawFd};

pub(super) struct ChildPlan {
    pub image: RawFd,
    pub input: RawFd,
    pub stdout: RawFd,
    pub stderr: RawFd,
    pub error: RawFd,
}
pub(super) struct Task {
    pub pid: libc::pid_t,
    pidfd: Option<File>,
    pub reaped: bool,
    pub kill_requested: bool,
}
pub(super) fn validate_plan(plan: &ChildPlan) -> Result<()> {
    let fds = [plan.image, plan.input, plan.stdout, plan.stderr, plan.error];
    for (index, fd) in fds.iter().enumerate() {
        if *fd < 3 || fds[..index].contains(fd) {
            return Err(LaunchError::Invalid("FD plan collision"));
        }
    }
    Ok(())
}

pub(super) fn spawn(
    plan: &ChildPlan,
    argv: &[CString],
    env: &[CString],
    cgroup: Option<&File>,
) -> Result<Task> {
    validate_plan(plan)?;
    let argv: Vec<_> = argv
        .iter()
        .map(|s| s.as_ptr())
        .chain(std::iter::once(std::ptr::null()))
        .collect();
    let env: Vec<_> = env
        .iter()
        .map(|s| s.as_ptr())
        .chain(std::iter::once(std::ptr::null()))
        .collect();
    let mut pidfd: libc::c_int = -1;
    let mut args = libc::clone_args {
        flags: libc::CLONE_PIDFD as u64,
        pidfd: (&mut pidfd as *mut libc::c_int) as u64,
        exit_signal: libc::SIGCHLD as u64,
        child_tid: 0,
        parent_tid: 0,
        stack: 0,
        stack_size: 0,
        tls: 0,
        set_tid: 0,
        set_tid_size: 0,
        cgroup: 0,
    };
    if let Some(directory) = cgroup {
        args.flags |= 0x200000000; // Linux CLONE_INTO_CGROUP; never a post-spawn placement fallback.
        args.cgroup = directory.as_raw_fd() as u64;
    }
    // SAFETY: clone_args and its writable pidfd slot remain live across the syscall.
    // No CLONE_VM/FILES/THREAD sharing is requested. The child never returns into Rust
    // callers or runs destructors: it uses the prebuilt plan, execveat or _exit only.
    let pid = unsafe {
        libc::syscall(
            libc::SYS_clone3,
            &args,
            std::mem::size_of::<libc::clone_args>(),
        )
    };
    if pid < 0 {
        return Err(io::Error::last_os_error().into());
    }
    if pid == 0 {
        // SAFETY: all arrays and source FDs were prepared and kept owned by the caller.
        // This branch cannot allocate, unwind, lock, log, or return to its caller.
        unsafe { child_exec(plan, argv.as_ptr(), env.as_ptr()) }
    }
    // SAFETY: successful CLONE_PIDFD installs one new owned FD in this parent's slot.
    // No other owner has been constructed; the child has a separate descriptor table.
    let pidfd = unsafe { File::from_raw_fd(pidfd) };
    Ok(Task {
        pid: pid as libc::pid_t,
        pidfd: Some(pidfd),
        reaped: false,
        kill_requested: false,
    })
}

unsafe fn child_exec(
    plan: &ChildPlan,
    argv: *const *const libc::c_char,
    env: *const *const libc::c_char,
) -> ! {
    for (source, target) in [(plan.input, 0), (plan.stdout, 1), (plan.stderr, 2)] {
        // SAFETY: source FDs are owned/live, above stdio, and the child has a private FD table.
        if unsafe { libc::dup2(source, target) } < 0 {
            // SAFETY: the error pipe is owned/live and the child must terminate without unwinding.
            unsafe { child_error(plan.error, 1) }
        }
    }
    // SAFETY: this changes only the child's descriptor flags, not the parent's.
    // The image and error FD remain usable before exec; only 0/1/2 survive a successful ELF exec.
    if unsafe {
        libc::syscall(
            libc::SYS_close_range,
            3u32,
            u32::MAX,
            libc::CLOSE_RANGE_CLOEXEC,
        )
    } < 0
    {
        // SAFETY: fixed error reporting and _exit do not return or allocate.
        unsafe { child_error(plan.error, 2) }
    }
    // SAFETY: image is the same sealed FD retained by the parent; pathname is a static
    // empty C string. Null-terminated pointer arrays and their CStrings live in this
    // child's copied address space. The syscall, unlike nix's wrapper, does not allocate.
    unsafe {
        libc::syscall(
            libc::SYS_execveat,
            plan.image,
            c"".as_ptr(),
            argv,
            env,
            libc::AT_EMPTY_PATH,
        );
        child_error(plan.error, 3)
    }
}

unsafe fn child_error(fd: RawFd, stage: u32) -> ! {
    // SAFETY: clone without CLONE_VM preserves valid thread-local errno storage.
    let errno = unsafe { *libc::__errno_location() };
    let mut record = [0u8; 16];
    record[..4].copy_from_slice(b"FLX1");
    record[4..8].copy_from_slice(&stage.to_le_bytes());
    record[8..12].copy_from_slice(&errno.to_le_bytes());
    let mut offset = 0;
    while offset < record.len() {
        // SAFETY: the remaining fixed stack slice is valid; the dedicated blocking pipe
        // has one writer and enough room for this <= PIPE_BUF record.
        let count = unsafe {
            libc::write(
                fd,
                record.as_ptr().add(offset).cast(),
                record.len() - offset,
            )
        };
        if count > 0 {
            offset += count as usize;
        } else {
            // SAFETY: errno remains valid; no high-level error allocation is performed.
            if count < 0 && unsafe { *libc::__errno_location() } == libc::EINTR {
                continue;
            }
            break;
        }
    }
    // SAFETY: terminate only this newly created process, bypassing inherited Rust/libc cleanup.
    unsafe { libc::_exit(127) }
}

pub(super) fn terminate(task: &Task) -> Result<()> {
    // SAFETY: pidfd is owned and identifies this exact task, even if its PID is recycled.
    // SIGKILL uses no siginfo; flags are zero.
    let result = unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            task.pidfd().as_raw_fd(),
            libc::SIGKILL,
            std::ptr::null::<libc::siginfo_t>(),
            0,
        )
    };
    if result < 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(LaunchError::Io(error));
        }
    }
    Ok(())
}

struct UnreapedTask {
    pid: libc::pid_t,
    pidfd: File,
}
static QUARANTINE: std::sync::Mutex<Vec<UnreapedTask>> = std::sync::Mutex::new(Vec::new());

impl Drop for Task {
    fn drop(&mut self) {
        if self.reaped {
            return;
        }
        if let Err(error) = terminate(self) {
            eprintln!(
                "NATIVE_LAUNCH quarantine stop failed for PID {}: {error}",
                self.pid
            );
        }
        match self.try_reap() {
            Ok(
                nix::sys::wait::WaitStatus::Exited(..) | nix::sys::wait::WaitStatus::Signaled(..),
            ) => {}
            other => {
                eprintln!(
                    "NATIVE_LAUNCH unreaped task quarantined, PID {}: {other:?}",
                    self.pid
                );
                if let Some(pidfd) = self.pidfd.take() {
                    let task = UnreapedTask {
                        pid: self.pid,
                        pidfd,
                    };
                    quarantine().push(task);
                }
            }
        }
    }
}

impl Task {
    pub fn pidfd(&self) -> &File {
        self.pidfd
            .as_ref()
            .expect("live Task owns its pidfd until Drop")
    }
    pub fn try_reap(&self) -> nix::Result<nix::sys::wait::WaitStatus> {
        use nix::sys::wait::{waitid, Id, WaitPidFlag};
        waitid(
            Id::PIDFd(self.pidfd().as_fd()),
            WaitPidFlag::WEXITED | WaitPidFlag::WNOHANG,
        )
    }
    pub fn finish(mut self) -> Result<()> {
        if !self.reaped {
            return Err(LaunchError::Invalid("unreaped task retained in quarantine"));
        }
        if let Some(fd) = self.pidfd.take() {
            nix::unistd::close(fd)?;
        }
        Ok(())
    }
}

fn quarantine() -> std::sync::MutexGuard<'static, Vec<UnreapedTask>> {
    QUARANTINE.lock().unwrap_or_else(|error| {
        eprintln!("NATIVE_LAUNCH quarantine registry poisoned; retaining task ownership");
        error.into_inner()
    })
}

#[cfg(test)]
pub(super) fn quarantined_task_count() -> usize {
    quarantine().len()
}

pub(super) fn retry_quarantined_reaps() -> Vec<(libc::pid_t, String)> {
    let mut tasks = quarantine();
    let mut errors = Vec::new();
    tasks.retain(|task| {
        match nix::sys::wait::waitid(
            nix::sys::wait::Id::PIDFd(task.pidfd.as_fd()),
            nix::sys::wait::WaitPidFlag::WEXITED | nix::sys::wait::WaitPidFlag::WNOHANG,
        ) {
            Ok(
                nix::sys::wait::WaitStatus::Exited(..) | nix::sys::wait::WaitStatus::Signaled(..),
            ) => false,
            Ok(nix::sys::wait::WaitStatus::StillAlive) => true,
            other => {
                errors.push((task.pid, format!("{other:?}")));
                true
            }
        }
    });
    errors
}
