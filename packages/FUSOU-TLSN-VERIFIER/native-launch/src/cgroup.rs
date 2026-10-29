use crate::prepare::{Controller, Lease, Owner, Stage};
use crate::sys::Credentials;
use crate::{LaunchError, Result};
use nix::fcntl::{open, openat, AtFlags, OFlag};
use nix::sys::stat::{fstatat, mkdirat, Mode};
use nix::sys::statfs::{fstatfs, CGROUP2_SUPER_MAGIC};
use nix::unistd::{close, unlinkat, UnlinkatFlags};
use std::fs::File;
use std::io::{Read, Write};
use std::os::unix::fs::{FileExt, MetadataExt};
use std::path::{Component, Path};

fn directory(parent: &File, name: &str) -> Result<File> {
    Ok(File::from(openat(
        parent,
        name,
        OFlag::O_RDONLY | OFlag::O_DIRECTORY | OFlag::O_CLOEXEC | OFlag::O_NOFOLLOW,
        Mode::empty(),
    )?))
}
fn control(parent: &File, name: &str, write: bool) -> Result<File> {
    let file = File::from(openat(
        parent,
        name,
        OFlag::O_CLOEXEC
            | OFlag::O_NOFOLLOW
            | if write {
                OFlag::O_WRONLY
            } else {
                OFlag::O_RDONLY
            },
        Mode::empty(),
    )?);
    protected(&file)?;
    Ok(file)
}
fn protected(file: &File) -> Result<()> {
    let metadata = file.metadata()?;
    if metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
        return Err(LaunchError::Invalid(
            "cgroup boundary must be root owned and not group/world writable",
        ));
    }
    Ok(())
}
fn write_control(parent: &File, name: &str, value: &[u8]) -> Result<()> {
    let mut file = control(parent, name, true)?;
    if file.write(value)? != value.len() {
        return Err(LaunchError::Invalid("short cgroup control write"));
    }
    close(file)?;
    Ok(())
}
fn text(file: &File) -> Result<String> {
    let mut buffer = [0; 4096];
    let size = file.read_at(&mut buffer, 0)?;
    if size == buffer.len() {
        return Err(LaunchError::Invalid("cgroup control read bound"));
    }
    String::from_utf8(buffer[..size].to_vec())
        .map_err(|_| LaunchError::Invalid("cgroup control UTF-8"))
}
pub(crate) fn populated(raw: &str) -> Result<bool> {
    let values: Vec<_> = raw
        .lines()
        .filter_map(|line| line.strip_prefix("populated "))
        .collect();
    match values.as_slice() {
        ["0"] => Ok(false),
        ["1"] => Ok(true),
        _ => Err(LaunchError::Invalid("cgroup populated unknown/duplicate")),
    }
}
pub(crate) struct DelegatedRoot {
    directory: File,
    pub credentials: Credentials,
}
impl DelegatedRoot {
    pub fn open(path: &Path, credentials: Credentials) -> Result<Self> {
        crate::sys::validate_credentials(credentials)?;
        if !path.is_absolute() {
            return Err(LaunchError::Invalid("delegation path must be absolute"));
        }
        let mut current = File::from(open(
            "/",
            OFlag::O_RDONLY | OFlag::O_DIRECTORY | OFlag::O_CLOEXEC | OFlag::O_NOFOLLOW,
            Mode::empty(),
        )?);
        for part in path.components() {
            match part {
                Component::RootDir => {}
                Component::Normal(name) => {
                    current = directory(
                        &current,
                        name.to_str()
                            .ok_or(LaunchError::Invalid("delegation path UTF-8"))?,
                    )?;
                    protected(&current)?;
                }
                _ => return Err(LaunchError::Invalid("delegation path component")),
            }
        }
        if fstatfs(&current)?.filesystem_type() != CGROUP2_SUPER_MAGIC {
            return Err(LaunchError::Invalid("delegation is not cgroup2"));
        }
        let parent = directory(&current, "..")?;
        if fstatfs(&parent)?.filesystem_type() != CGROUP2_SUPER_MAGIC
            || parent.metadata()?.ino() == current.metadata()?.ino()
        {
            return Err(LaunchError::Invalid("root cgroup is forbidden"));
        }
        if text(&control(&current, "cgroup.type", false)?)?.trim() != "domain" {
            return Err(LaunchError::Invalid("delegation must be a domain"));
        }
        for name in ["cgroup.controllers", "cgroup.subtree_control"] {
            let enabled = text(&control(&current, name, false)?)?;
            if !["memory", "pids"]
                .iter()
                .all(|required| enabled.split_whitespace().any(|item| item == *required))
            {
                return Err(LaunchError::Invalid(
                    "memory/pids must already be delegated/enabled",
                ));
            }
        }
        // All possible common ancestors outside a leaf must deny target credential writes.
        // Root ownership plus removed capabilities/NNP prevents chmod/setuid bypass.
        let mut ancestor = directory(&current, ".")?;
        loop {
            protected(&ancestor)?;
            protected(&control(&ancestor, "cgroup.procs", false)?)?;
            let above = directory(&ancestor, "..")?;
            if fstatfs(&above)?.filesystem_type() != CGROUP2_SUPER_MAGIC
                || above.metadata()?.ino() == ancestor.metadata()?.ino()
            {
                break;
            }
            ancestor = above;
        }
        Ok(Self {
            directory: current,
            credentials,
        })
    }
    pub fn create(&self, memory_max: u64, pids_max: u32, lease: &mut Lease) -> Result<Cgroup> {
        lease.cleanup_pending = true;
        lease.controller.charge(Stage::Fds, 4096)?;
        lease.controller.charge(Stage::Stop, 4096)?;
        lease.controller.charge(Stage::Cleanup, 4096)?;
        if memory_max == 0 || pids_max == 0 {
            return Err(LaunchError::Invalid("cgroup resource limits"));
        }
        let mut random = [0; 16];
        lease.controller.read()?;
        let mut random_source = File::open("/dev/urandom")?;
        if random_source.read(&mut random)? != random.len() {
            return Err(LaunchError::Invalid("short cgroup identifier read"));
        }
        close(random_source)?;
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let name = format!("fusou-op-{suffix}");
        let parent = self.directory.try_clone()?;
        mkdirat(&self.directory, name.as_str(), Mode::S_IRWXU)?;
        let mut group = Cgroup {
            root: Some(parent),
            name,
            directory: None,
            kill: None,
            events: None,
            identity: None,
            removed: false,
            credentials: self.credentials,
            owner: Owner::of(lease),
            controller: lease.controller.clone(),
        };
        let result = (|| {
            let leaf = directory(&self.directory, &group.name)?;
            protected(&leaf)?;
            let metadata = leaf.metadata()?;
            group.identity = Some((metadata.dev(), metadata.ino()));
            group.directory = Some(leaf);
            let leaf = group.fd()?;
            write_control(leaf, "memory.max", memory_max.to_string().as_bytes())?;
            write_control(leaf, "pids.max", pids_max.to_string().as_bytes())?;
            close(control(leaf, "cgroup.procs", false)?)?;
            group.kill = Some(control(leaf, "cgroup.kill", true)?);
            group.events = Some(control(group.fd()?, "cgroup.events", false)?);
            if !group.empty()? {
                return Err(LaunchError::Invalid("new operation cgroup is populated"));
            }
            Ok(())
        })();
        if let Err(error) = result {
            return Err(error);
        } // Drop quarantines partially prepared leaves.
        Ok(group)
    }
}

pub(crate) struct Cgroup {
    root: Option<File>,
    name: String,
    directory: Option<File>,
    kill: Option<File>,
    events: Option<File>,
    identity: Option<(u64, u64)>,
    removed: bool,
    pub credentials: Credentials,
    pub owner: Owner,
    controller: Controller,
}
impl Cgroup {
    pub fn fd(&self) -> Result<&File> {
        self.directory
            .as_ref()
            .ok_or(LaunchError::Invalid("operation cgroup FD missing"))
    }
    pub fn kill(&mut self) -> Result<()> {
        let file = self
            .kill
            .as_ref()
            .ok_or(LaunchError::Invalid("cgroup kill FD missing"))?;
        if file.write_at(b"1", 0)? != 1 {
            return Err(LaunchError::Invalid("short cgroup kill write"));
        }
        Ok(())
    }
    pub fn empty(&self) -> Result<bool> {
        self.controller.read()?;
        self.controller.charge(Stage::Cleanup, 4096)?;
        let events = self
            .events
            .as_ref()
            .ok_or(LaunchError::Invalid("cgroup events FD missing"))?;
        Ok(!populated(&text(events)?)?)
    }
    pub fn dispose(&mut self) -> Result<()> {
        if self.removed || !self.empty()? {
            return Err(LaunchError::Invalid("cgroup disposal state"));
        }
        let root = self
            .root
            .as_ref()
            .ok_or(LaunchError::Invalid("cgroup parent FD missing"))?;
        let stat = fstatat(root, self.name.as_str(), AtFlags::AT_SYMLINK_NOFOLLOW)?;
        if self.identity != Some((stat.st_dev, stat.st_ino)) {
            return Err(LaunchError::Invalid("operation cgroup identity changed"));
        }
        for fd in [&mut self.kill, &mut self.events, &mut self.directory] {
            if let Some(fd) = fd.take() {
                close(fd)?;
            }
        }
        unlinkat(root, self.name.as_str(), UnlinkatFlags::RemoveDir)?;
        match fstatat(root, self.name.as_str(), AtFlags::AT_SYMLINK_NOFOLLOW) {
            Err(nix::errno::Errno::ENOENT) => {}
            other => {
                return Err(LaunchError::Input(format!(
                    "cgroup removal unconfirmed: {other:?}"
                )))
            }
        }
        if let Some(fd) = self.root.take() {
            close(fd)?;
        }
        self.removed = true;
        Ok(())
    }
}
static QUARANTINE: std::sync::Mutex<Vec<Cgroup>> = std::sync::Mutex::new(Vec::new());
impl Drop for Cgroup {
    fn drop(&mut self) {
        if self.removed {
            return;
        }
        if self.kill.is_some() {
            if let Err(error) = self.kill() {
                eprintln!("NATIVE_LAUNCH cgroup quarantine kill: {error}");
            }
        }
        eprintln!(
            "NATIVE_LAUNCH cgroup {} retained; disposal unconfirmed",
            self.name
        );
        let retained = Self {
            root: self.root.take(),
            name: std::mem::take(&mut self.name),
            directory: self.directory.take(),
            kill: self.kill.take(),
            events: self.events.take(),
            identity: self.identity,
            removed: false,
            credentials: self.credentials,
            owner: self.owner.clone(),
            controller: self.controller.clone(),
        };
        self.removed = true;
        QUARANTINE
            .lock()
            .unwrap_or_else(|error| {
                eprintln!("NATIVE_LAUNCH cgroup quarantine poisoned; retaining ownership");
                error.into_inner()
            })
            .push(retained);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn populated_requires_exact_unique_kernel_field() {
        assert!(populated("populated 1\nfrozen 0\n").unwrap());
        assert!(!populated("populated 0\n").unwrap());
        for raw in [
            "",
            "populated 2\n",
            "populated 0\npopulated 1\n",
            "populated 0 x\n",
        ] {
            assert!(populated(raw).is_err());
        }
    }
    #[test]
    fn missing_switch_authority_rejects_before_filesystem_mutation() {
        let result = DelegatedRoot::open(
            Path::new("/not-a-delegated-subtree"),
            Credentials { uid: 0, gid: 0 },
        );
        assert!(result.is_err());
    }

    #[test]
    fn fake_event_file_cannot_exceed_cleanup_or_read_reservations() {
        let controller = crate::ipc_peer::controller();
        let lease = controller
            .begin(&crate::prepare::synthetic_permit())
            .unwrap();
        let mut caps = [0; 7];
        caps[6] = 4096;
        controller.state.lock().unwrap().bridge_caps = Some(caps);
        let mut events = File::from(
            nix::sys::memfd::memfd_create(
                c"fake-cgroup-events",
                nix::sys::memfd::MFdFlags::MFD_CLOEXEC
                    | nix::sys::memfd::MFdFlags::from_bits_retain(0x08),
            )
            .unwrap(),
        );
        events.write_all(b"populated 0\n").unwrap();
        let group = Cgroup {
            root: None,
            name: String::new(),
            directory: None,
            kill: None,
            events: Some(events),
            identity: None,
            removed: true,
            credentials: Credentials {
                uid: 65534,
                gid: 65534,
            },
            owner: Owner::of(&lease),
            controller: controller.clone(),
        };
        assert!(group.empty().unwrap());
        assert!(group.empty().is_err());
        assert_eq!(controller.state.lock().unwrap().reads, 2);
        assert_eq!(controller.state.lock().unwrap().work[6], 4096);
    }
}
