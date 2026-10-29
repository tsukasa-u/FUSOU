use crate::{LaunchError, Result};
use fusou_tlsn_verifier::offline_fd::{read_sealed_file, FdInputLimits};
use nix::fcntl::{fcntl, FcntlArg, SealFlag};
use nix::sys::memfd::{memfd_create, MFdFlags};
use sha2::{Digest, Sha256};
use std::ffi::{CString, OsStr};
use std::fs::File;
use std::io::Write;
use std::os::fd::AsFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileExt, PermissionsExt};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const SEAL_EXEC: i32 = 0x20;
const IMMUTABLE: i32 = 0x01 | 0x02 | 0x04 | 0x08 | SEAL_EXEC;
const KNOWN_SEALS: i32 = 0x3f;

pub(crate) struct Permit {
    _private: (),
}
#[cfg(test)]
pub(crate) fn synthetic_permit() -> Permit {
    Permit { _private: () }
}

#[derive(Clone, Debug)]
pub(crate) struct Limits {
    pub image_bytes: usize,
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
    pub total_capture_bytes: usize,
    pub drain_bytes: usize,
    pub max_work: usize,
    pub max_reads: usize,
    pub max_active: usize,
    pub timeout: Duration,
    pub cleanup_timeout: Duration,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum Stage {
    Image,
    Input,
    Fds,
    Execution,
    Capture,
    Stop,
    Cleanup,
}
impl Stage {
    fn index(self) -> usize {
        self as usize
    }
}

#[derive(Default, Debug)]
pub(crate) struct State {
    pub active: usize,
    pub quarantined: usize,
    pub work: [usize; 7],
    pub bridge_caps: Option<[usize; 7]>,
    pub bridge_reads: Option<usize>,
    pub reads: usize,
    pub next_id: u64,
}
#[derive(Clone)]
pub(crate) struct Controller {
    pub limits: Limits,
    pub state: Arc<Mutex<State>>,
}
impl Controller {
    pub fn new(limits: Limits, _permit: &Permit) -> Result<Self> {
        if [
            limits.image_bytes,
            limits.stdout_bytes,
            limits.stderr_bytes,
            limits.total_capture_bytes,
            limits.drain_bytes,
            limits.max_work,
            limits.max_reads,
            limits.max_active,
        ]
        .contains(&0)
            || limits.timeout.is_zero()
            || limits.cleanup_timeout.is_zero()
            || limits.max_active > 64
            || limits.stdout_bytes > limits.total_capture_bytes
            || limits.stderr_bytes > limits.total_capture_bytes
        {
            return Err(LaunchError::Invalid("resource limits"));
        }
        Ok(Self {
            limits,
            state: Arc::new(Mutex::new(State::default())),
        })
    }
    pub fn begin(&self, _permit: &Permit) -> Result<Lease> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| LaunchError::Invalid("controller poisoned"))?;
        if state.active >= self.limits.max_active {
            return Err(LaunchError::Invalid("resource busy"));
        }
        state.next_id = state
            .next_id
            .checked_add(1)
            .ok_or(LaunchError::Invalid("operation overflow"))?;
        state.active += 1;
        Ok(Lease {
            controller: self.clone(),
            id: state.next_id,
            spawned: false,
            cleanup_pending: false,
            released: false,
        })
    }
    pub fn charge(&self, stage: Stage, count: usize) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| LaunchError::Invalid("controller poisoned"))?;
        let total = state
            .work
            .iter()
            .try_fold(0usize, |a, b| a.checked_add(*b))
            .ok_or(LaunchError::Invalid("work overflow"))?;
        if count > self.limits.max_work.saturating_sub(total) {
            return Err(LaunchError::Invalid("work budget exceeded"));
        }
        if state.bridge_caps.is_some_and(|caps| {
            count > caps[stage.index()].saturating_sub(state.work[stage.index()])
        }) {
            return Err(LaunchError::Invalid(
                "native bridge stage reservation exceeded",
            ));
        }
        state.work[stage.index()] += count;
        Ok(())
    }
    pub fn read(&self) -> Result<()> {
        self.reserve_reads(1)
    }
    pub fn reserve_reads(&self, count: usize) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| LaunchError::Invalid("controller poisoned"))?;
        let limit = self
            .limits
            .max_reads
            .min(state.bridge_reads.unwrap_or(self.limits.max_reads));
        if count > limit.saturating_sub(state.reads) {
            return Err(LaunchError::Invalid("read budget exceeded"));
        }
        state.reads += count;
        Ok(())
    }
}
pub(crate) struct Lease {
    pub controller: Controller,
    pub id: u64,
    pub spawned: bool,
    pub cleanup_pending: bool,
    released: bool,
}
impl Lease {
    pub fn finish(&mut self, cleanup_verified: bool) -> Result<()> {
        if self.released {
            return Err(LaunchError::Invalid("operation already settled"));
        }
        let mut state = self
            .controller
            .state
            .lock()
            .map_err(|_| LaunchError::Invalid("controller poisoned"))?;
        if cleanup_verified {
            state.active -= 1;
        } else {
            state.quarantined += 1;
        }
        self.released = true;
        Ok(())
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if !self.released {
            if let Ok(mut state) = self.controller.state.lock() {
                if self.spawned || self.cleanup_pending {
                    state.quarantined += 1;
                } else {
                    state.active -= 1;
                }
            } else {
                eprintln!(
                    "NATIVE_LAUNCH lease {} cleanup unconfirmed: controller poisoned",
                    self.id
                );
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ExpectedPin {
    pub length: u64,
    pub sha256: [u8; 32],
}
pub(crate) struct Image {
    pub file: File,
    pub pin: ExpectedPin,
    pub has_interpreter: bool,
    pub has_dynamic: bool,
    pub owner: Owner,
}
pub(crate) struct Input {
    pub file: File,
    pub pin: ExpectedPin,
    pub owner: Owner,
}
#[derive(Clone)]
pub(crate) struct Owner {
    state: Arc<Mutex<State>>,
    id: u64,
}
impl Owner {
    pub fn of(lease: &Lease) -> Self {
        Self {
            state: lease.controller.state.clone(),
            id: lease.id,
        }
    }
    pub fn require(&self, lease: &Lease) -> Result<()> {
        if self.id != lease.id || !Arc::ptr_eq(&self.state, &lease.controller.state) {
            return Err(LaunchError::Invalid("operation owner mismatch"));
        }
        Ok(())
    }
}
pub(crate) fn owned_above_stdio(file: File) -> Result<File> {
    Ok(File::from(file.as_fd().try_clone_to_owned()?))
}
fn memfd(name: &str, executable: bool) -> Result<File> {
    let flags = MFdFlags::MFD_CLOEXEC
        | MFdFlags::MFD_ALLOW_SEALING
        | MFdFlags::from_bits_retain(if executable { 0x10 } else { 0x08 });
    let fd = memfd_create(name, flags).map_err(|error| memfd_error(error, executable))?;
    owned_above_stdio(File::from(fd))
}
pub(crate) fn memfd_error(error: nix::errno::Errno, executable: bool) -> LaunchError {
    if executable {
        LaunchError::ExecutableMemfd(error)
    } else {
        LaunchError::Syscall(error)
    }
}
pub(crate) fn validate_seals(seals: i32) -> Result<()> {
    if seals & !KNOWN_SEALS != 0 {
        return Err(LaunchError::Invalid("unsupported seals"));
    }
    if seals & IMMUTABLE != IMMUTABLE {
        return Err(LaunchError::Invalid("missing seals"));
    }
    Ok(())
}
fn seal(file: &File, executable: bool) -> Result<()> {
    file.set_permissions(std::fs::Permissions::from_mode(if executable {
        0o500
    } else {
        0o400
    }))?;
    fcntl(
        file,
        FcntlArg::F_ADD_SEALS(SealFlag::from_bits_retain(IMMUTABLE)),
    )?;
    Ok(())
}
pub(crate) fn inspect(
    file: &File,
    pin: ExpectedPin,
    executable: bool,
    max: usize,
    controller: &Controller,
) -> Result<()> {
    let seals = fcntl(file, FcntlArg::F_GET_SEALS)?;
    validate_seals(seals)?;
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.permissions().mode() & 0o7777 != if executable { 0o500 } else { 0o400 }
    {
        return Err(LaunchError::Invalid("FD kind or executable mode"));
    }
    if metadata.len() != pin.length || pin.length > max as u64 {
        return Err(LaunchError::Invalid("pin length or size limit"));
    }
    let mut hash = Sha256::new();
    let mut offset = 0;
    let mut chunk = [0; 16384];
    while offset < pin.length {
        controller.read()?;
        let length = usize::try_from((pin.length - offset).min(chunk.len() as u64))
            .map_err(|_| LaunchError::Invalid("length overflow"))?;
        let count = file.read_at(&mut chunk[..length], offset)?;
        if count == 0 {
            return Err(LaunchError::Invalid("truncated inode"));
        }
        hash.update(&chunk[..count]);
        offset += count as u64;
    }
    if <[u8; 32]>::from(hash.finalize()) != pin.sha256 {
        return Err(LaunchError::Invalid("pin digest"));
    }
    Ok(())
}
pub(crate) fn read_exact_bounded(
    file: &File,
    mut bytes: &mut [u8],
    mut offset: u64,
    controller: &Controller,
) -> Result<()> {
    while !bytes.is_empty() {
        controller.read()?;
        match file.read_at(bytes, offset) {
            Ok(0) => return Err(LaunchError::Invalid("short positional read")),
            Ok(count) => {
                offset = offset
                    .checked_add(count as u64)
                    .ok_or(LaunchError::Invalid("read offset overflow"))?;
                bytes = &mut bytes[count..];
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
pub(crate) fn prepare_image(source: &File, pin: ExpectedPin, lease: &Lease) -> Result<Image> {
    let size = source.metadata()?.len();
    if size != pin.length || size > lease.controller.limits.image_bytes as u64 || size < 64 {
        return Err(LaunchError::Invalid("image length"));
    }
    let work = usize::try_from(size)
        .ok()
        .and_then(|n| n.checked_mul(3))
        .ok_or(LaunchError::Invalid("image work overflow"))?;
    lease.controller.charge(Stage::Image, work)?;
    let mut file = memfd("fusou-synthetic-image", true)?;
    let mut offset = 0;
    let mut chunk = [0; 16384];
    while offset < size {
        lease.controller.read()?;
        let length = (size - offset).min(chunk.len() as u64) as usize;
        let count = source.read_at(&mut chunk[..length], offset)?;
        if count == 0 {
            return Err(LaunchError::Invalid("source truncation"));
        }
        file.write_all(&chunk[..count])?;
        offset += count as u64;
    }
    seal(&file, true)?;
    inspect(
        &file,
        pin,
        true,
        lease.controller.limits.image_bytes,
        &lease.controller,
    )?;
    let mut header = [0; 64];
    read_exact_bounded(&file, &mut header, 0, &lease.controller)?;
    if &header[..7] != b"\x7fELF\x02\x01\x01"
        || u16::from_le_bytes([header[18], header[19]]) != 62
        || ![2, 3].contains(&u16::from_le_bytes([header[16], header[17]]))
    {
        return Err(LaunchError::Invalid("only Linux x86_64 ELF images"));
    }
    let phoff = u64::from_le_bytes(
        header[32..40]
            .try_into()
            .map_err(|_| LaunchError::Invalid("ELF header"))?,
    );
    let phsize = u16::from_le_bytes([header[54], header[55]]);
    let phnum = u16::from_le_bytes([header[56], header[57]]);
    if phsize != 56
        || phnum == 0
        || phnum > 1024
        || phoff
            .checked_add(u64::from(phnum) * 56)
            .is_none_or(|end| end > size)
    {
        return Err(LaunchError::Invalid("ELF program table"));
    }
    let (mut has_interpreter, mut has_dynamic) = (false, false);
    for index in 0..phnum {
        let mut kind = [0; 4];
        read_exact_bounded(
            &file,
            &mut kind,
            phoff + u64::from(index) * 56,
            &lease.controller,
        )?;
        has_interpreter |= u32::from_le_bytes(kind) == 3;
        has_dynamic |= u32::from_le_bytes(kind) == 2;
    }
    Ok(Image {
        file,
        pin,
        has_interpreter,
        has_dynamic,
        owner: Owner::of(lease),
    })
}
pub(crate) fn prepare_input(
    raw: &[u8],
    pin: ExpectedPin,
    limits: &FdInputLimits,
    lease: &Lease,
) -> Result<Input> {
    limits
        .validate()
        .map_err(|error| LaunchError::Input(error.to_string()))?;
    if raw.len() as u64 != pin.length || raw.len() > limits.max_frame_bytes {
        return Err(LaunchError::Invalid("input length"));
    }
    // Reserve a conservative parser-work ceiling before its owned table/frame/JSON allocations.
    let work = limits
        .max_json_bytes
        .checked_mul(limits.max_entries)
        .and_then(|n| n.checked_mul(16))
        .and_then(|n| raw.len().checked_mul(4).and_then(|b| n.checked_add(b)))
        .ok_or(LaunchError::Invalid("input work overflow"))?;
    lease.controller.charge(Stage::Input, work)?;
    let mut file = memfd("fusou-synthetic-input", false)?;
    file.write_all(raw)?;
    seal(&file, false)?;
    inspect(&file, pin, false, limits.max_frame_bytes, &lease.controller)?;
    lease.controller.reserve_reads(limits.max_read_calls)?;
    read_sealed_file(&file, limits).map_err(|error| LaunchError::Input(error.to_string()))?;
    Ok(Input {
        file,
        pin,
        owner: Owner::of(lease),
    })
}
pub(crate) struct Arguments {
    pub argv: Vec<CString>,
    pub env: Vec<CString>,
    pub owner: Owner,
}
impl Arguments {
    pub fn new(args: &[&OsStr], env: &[(&str, &OsStr)], lease: &Lease) -> Result<Self> {
        let modes = [
            "echo",
            "digest",
            "flood",
            "stdout",
            "stderr",
            "sleep",
            "paired",
            "exit127",
            "signal",
            "fds",
            "ordinary-read",
        ];
        if args.len() != 2
            || env.len() > 1
            || args[0] != OsStr::new("fusou-synthetic-probe")
            || !modes.iter().any(|mode| args[1] == OsStr::new(mode))
        {
            return Err(LaunchError::Invalid("argument allowlist"));
        }
        let size = args
            .iter()
            .map(|s| s.as_bytes().len())
            .chain(env.iter().map(|(k, v)| k.len() + 1 + v.as_bytes().len()))
            .try_fold(0usize, |a, n| a.checked_add(n))
            .ok_or(LaunchError::Invalid("argument overflow"))?;
        if size > 4096
            || env
                .iter()
                .any(|(key, _)| *key != "FUSOU_SYNTHETIC_OPERATION")
        {
            return Err(LaunchError::Invalid("environment allowlist"));
        }
        lease.controller.charge(
            Stage::Fds,
            size.checked_mul(2)
                .ok_or(LaunchError::Invalid("argument work"))?,
        )?;
        let argv = args
            .iter()
            .map(|s| CString::new(s.as_bytes()).map_err(|_| LaunchError::Invalid("argv NUL")))
            .collect::<Result<Vec<_>>>()?;
        let env = env
            .iter()
            .map(|(k, v)| {
                let mut raw = k.as_bytes().to_vec();
                raw.push(b'=');
                raw.extend_from_slice(v.as_bytes());
                CString::new(raw).map_err(|_| LaunchError::Invalid("environment NUL"))
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            argv,
            env,
            owner: Owner::of(lease),
        })
    }
}
