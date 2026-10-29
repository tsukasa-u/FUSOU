use crate::prepare::*;
use crate::supervise::*;
use crate::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use fusou_tlsn_verifier::offline_fd::{parse_frame, FdInputLimits};
use nix::fcntl::{fcntl, FcntlArg, SealFlag};
use nix::sys::memfd::{memfd_create, MFdFlags};
use sha2::{Digest, Sha256};
use std::ffi::OsStr;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

fn limits() -> Limits {
    // Fixture-only numerical policy; not an approved issuer or process-global budget.
    Limits {
        image_bytes: 32 * 1024 * 1024,
        stdout_bytes: 16384,
        stderr_bytes: 16384,
        total_capture_bytes: 32768,
        drain_bytes: 131072,
        max_work: 512 * 1024 * 1024,
        max_reads: 16384,
        max_active: 1,
        timeout: Duration::from_secs(3),
        cleanup_timeout: Duration::from_secs(2),
    }
}
fn fd_limits() -> FdInputLimits {
    FdInputLimits {
        max_frame_bytes: 131072,
        max_entries: 64,
        max_entry_bytes: 65536,
        max_json_bytes: 65536,
        max_json_nodes: 2048,
        max_json_depth: 16,
        max_string_bytes: 4096,
        max_read_calls: 64,
    }
}
fn controller() -> Controller {
    Controller::new(limits(), &synthetic_permit()).unwrap()
}
fn frame() -> Vec<u8> {
    let vector: serde_json::Value =
        serde_json::from_str(include_str!("../../fixtures/offline-fd-v1-vector.json")).unwrap();
    STANDARD
        .decode(vector["frame_base64"].as_str().unwrap())
        .unwrap()
}
fn pin(raw: &[u8]) -> ExpectedPin {
    ExpectedPin {
        length: raw.len() as u64,
        sha256: Sha256::digest(raw).into(),
    }
}
fn fixture() -> (File, ExpectedPin) {
    let path = std::env::var_os("FUSOU_SYNTHETIC_PROBE")
        .expect("explicit compiled synthetic fixture path required");
    let raw = std::fs::read(&path).unwrap();
    (File::open(path).unwrap(), pin(&raw))
}
fn image(lease: &Lease) -> Image {
    let (source, expected) = fixture();
    prepare_image(&source, expected, lease).unwrap()
}
fn args(mode: &str, lease: &Lease) -> Arguments {
    Arguments::new(
        &[OsStr::new("fusou-synthetic-probe"), OsStr::new(mode)],
        &[],
        lease,
    )
    .unwrap()
}
fn run_with(c: &Controller, mode: &str, cancel: &AtomicBool) -> Observation {
    let permit = synthetic_permit();
    let lease = c.begin(&permit).unwrap();
    let input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    let arguments = args(mode, &lease);
    let child = launch(
        image(&lease),
        input,
        arguments,
        lease,
        Containment::DirectSynthetic,
        &permit,
    )
    .unwrap();
    let id = child.operation_id();
    let report = child.observe(cancel).unwrap();
    assert_eq!(report.operation_id, id);
    assert!(report.reaped, "{report:?}");
    assert!(report.fds_closed, "{report:?}");
    assert!(!report.tree_cleanup_verified);
    assert!(!report.slot_released);
    assert!(c.begin(&permit).is_err());
    report
}

pub(crate) fn observe_direct_bridge(
    lease: Lease,
    bridge: &mut crate::bridge::Bridge,
    cancelling: bool,
) {
    let input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    let arguments = args(if cancelling { "sleep" } else { "echo" }, &lease);
    let child = launch(
        image(&lease),
        input,
        arguments,
        lease,
        Containment::DirectSynthetic,
        &synthetic_permit(),
    )
    .unwrap();
    let report = child
        .observe_bridged(&AtomicBool::new(false), bridge)
        .unwrap();
    assert!(
        report.reaped && report.capture_eof && report.fds_closed,
        "{report:?}"
    );
    assert!(!report.slot_released && !report.tree_cleanup_verified);
    if cancelling {
        assert_eq!(report.stop, Stop::Cancelled);
    } else {
        assert_eq!(report.stdout.bytes, frame());
    }
}

#[test]
fn provider_gate_and_missing_containment_are_unconditionally_closed() {
    assert_eq!(
        registered_policy_context().err().unwrap().to_string(),
        "FD_POLICY_CONTEXT_NOT_REGISTERED"
    );
    assert!(require_delegated_containment()
        .err()
        .unwrap()
        .to_string()
        .contains("NOT_REGISTERED"));
}
#[test]
fn input_pin_and_abi_reject_corruption_overflow_truncation_trailing() {
    for kind in 0..5 {
        let c = controller();
        let lease = c.begin(&synthetic_permit()).unwrap();
        let mut raw = frame();
        let mut expected = pin(&raw);
        match kind {
            0 => expected.sha256[0] ^= 1,
            1 => {
                raw[0] ^= 1;
                expected = pin(&raw);
            }
            2 => {
                raw[24..32].copy_from_slice(&u64::MAX.to_le_bytes());
                expected = pin(&raw);
            }
            3 => {
                raw.pop();
                expected = pin(&raw);
            }
            _ => {
                raw.push(0);
                expected = pin(&raw);
            }
        }
        assert!(
            prepare_input(&raw, expected, &fd_limits(), &lease).is_err(),
            "{kind}"
        );
        assert!(c.state.lock().unwrap().work[Stage::Input as usize] > 0);
    }
    let c = controller();
    let lease = c.begin(&synthetic_permit()).unwrap();
    let mut expected = pin(&frame());
    expected.length += 1;
    assert!(prepare_input(&frame(), expected, &fd_limits(), &lease).is_err());
}
#[test]
fn shared_vector_parser_contract_is_unchanged() {
    let raw = frame();
    assert_eq!(u32::from_le_bytes(raw[16..20].try_into().unwrap()), 27);
    let parsed = parse_frame(raw, &fd_limits()).unwrap();
    let vector: serde_json::Value =
        serde_json::from_str(include_str!("../../fixtures/offline-fd-v1-vector.json")).unwrap();
    assert_eq!(parsed.binding(), &vector["binding"]);
}
#[test]
fn image_pin_length_digest_and_script_rejection() {
    let c = controller();
    let lease = c.begin(&synthetic_permit()).unwrap();
    let (source, expected) = fixture();
    let mut bad = expected;
    bad.length += 1;
    assert!(prepare_image(&source, bad, &lease).is_err());
    bad = expected;
    bad.sha256[0] ^= 1;
    assert!(prepare_image(&source, bad, &lease).is_err());
    let mut script = File::from(memfd_create("script", MFdFlags::MFD_CLOEXEC).unwrap());
    let raw = [b'#'; 128];
    script.write_all(&raw).unwrap();
    assert!(prepare_image(&script, pin(&raw), &lease).is_err());
    let sealed = image(&lease);
    c.state.lock().unwrap().reads = c.limits.max_reads;
    let mut header = [0; 64];
    assert!(read_exact_bounded(&sealed.file, &mut header, 0, &c).is_err());
}
#[test]
fn wrong_fd_kind_missing_seals_and_wrong_modes_are_rejected() {
    let c = controller();
    let lease = c.begin(&synthetic_permit()).unwrap();
    let (read, _write) = nix::unistd::pipe().unwrap();
    assert!(inspect(&File::from(read), pin(&[]), false, 1024, &c).is_err());
    let (socket, _peer) = std::os::unix::net::UnixStream::pair().unwrap();
    assert!(inspect(
        &File::from(std::os::fd::OwnedFd::from(socket)),
        pin(&[]),
        false,
        1024,
        &c
    )
    .is_err());
    let ordinary = fixture().0;
    assert!(inspect(&ordinary, pin(&[]), true, limits().image_bytes, &c).is_err());
    let unsealed = File::from(
        memfd_create(
            "unsealed",
            MFdFlags::MFD_CLOEXEC | MFdFlags::MFD_ALLOW_SEALING,
        )
        .unwrap(),
    );
    assert!(inspect(&unsealed, pin(&[]), false, 1024, &c).is_err());
    let sealed = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    assert!(inspect(&sealed.file, sealed.pin, true, limits().image_bytes, &c).is_err());
    let executable = image(&lease);
    assert!(inspect(
        &executable.file,
        executable.pin,
        false,
        limits().image_bytes,
        &c
    )
    .is_err());
    assert!(executable
        .file
        .set_permissions(std::fs::Permissions::from_mode(0o400))
        .is_err());
}
#[test]
fn input_positional_reader_does_not_depend_on_shared_cursor() {
    let c = controller();
    let lease = c.begin(&synthetic_permit()).unwrap();
    let mut input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    input.file.seek(SeekFrom::End(0)).unwrap();
    fusou_tlsn_verifier::offline_fd::read_sealed_file(&input.file, &fd_limits()).unwrap();
}
#[test]
fn argv_environment_and_work_admission_are_bounded() {
    let c = controller();
    let lease = c.begin(&synthetic_permit()).unwrap();
    assert!(Arguments::new(&[], &[], &lease).is_err());
    assert!(Arguments::new(&[OsStr::new("unapproved"), OsStr::new("echo")], &[], &lease).is_err());
    assert!(Arguments::new(
        &[
            OsStr::new("fusou-synthetic-probe"),
            OsStr::new("unapproved")
        ],
        &[],
        &lease
    )
    .is_err());
    assert!(Arguments::new(&[OsStr::new("x\0y")], &[], &lease).is_err());
    assert!(Arguments::new(
        &[OsStr::new("fusou-synthetic-probe"), OsStr::new("echo")],
        &[("LD_PRELOAD", OsStr::new("evil"))],
        &lease
    )
    .is_err());
    assert!(Arguments::new(
        &[OsStr::new("fusou-synthetic-probe"), OsStr::new("echo")],
        &[("PATH", OsStr::new("/bin"))],
        &lease
    )
    .is_err());
    assert!(c.charge(Stage::Image, c.limits.max_work + 1).is_err());
    assert!(c.begin(&synthetic_permit()).is_err());
    drop(lease);
    assert!(c.begin(&synthetic_permit()).is_ok());
}
#[test]
fn quarantine_is_not_release_or_a_refund_and_completion_is_single_use() {
    let c = controller();
    let mut lease = c.begin(&synthetic_permit()).unwrap();
    c.charge(Stage::Image, 100).unwrap();
    lease.spawned = true;
    lease.finish(false).unwrap();
    assert!(lease.finish(true).is_err());
    let state = c.state.lock().unwrap();
    assert_eq!(state.active, 1);
    assert_eq!(state.quarantined, 1);
    assert_eq!(state.work[Stage::Image as usize], 100);
}
#[test]
fn exec_error_protocol_never_promotes_incomplete_or_unknown_data() {
    assert_eq!(check_exec_report(&[], false), ExecReport::ProtocolFailure);
    assert_eq!(
        check_exec_report(&[], true),
        ExecReport::NoReportedExecError
    );
    assert_eq!(
        check_exec_report(b"FLX1", true),
        ExecReport::ProtocolFailure
    );
    let mut raw = [0; 16];
    raw[..4].copy_from_slice(b"FLX1");
    raw[4..8].copy_from_slice(&3u32.to_le_bytes());
    raw[8..12].copy_from_slice(&libc::ENOEXEC.to_le_bytes());
    assert_eq!(
        check_exec_report(&raw, true),
        ExecReport::Failed {
            stage: 3,
            errno: libc::ENOEXEC
        }
    );
    raw[4..8].copy_from_slice(&4u32.to_le_bytes());
    raw[8..12].copy_from_slice(&libc::EACCES.to_le_bytes());
    assert_eq!(
        check_exec_report(&raw, true),
        ExecReport::Failed {
            stage: 4,
            errno: libc::EACCES
        }
    );
    for stage in [0u32, 5, u32::MAX] {
        raw[4..8].copy_from_slice(&stage.to_le_bytes());
        assert_eq!(check_exec_report(&raw, true), ExecReport::ProtocolFailure);
    }
    raw[4..8].copy_from_slice(&4u32.to_le_bytes());
    raw[15] = 1;
    assert_eq!(check_exec_report(&raw, true), ExecReport::ProtocolFailure);
}

#[test]
fn process_exact_fd0_bytes_and_digest_and_quarantined_slot() {
    let report = run_with(&controller(), "echo", &AtomicBool::new(false));
    assert_eq!(report.exit, Some(Exit::Code(0)));
    assert_eq!(report.exec, ExecReport::NoReportedExecError);
    assert!(report.capture_eof);
    assert_eq!(report.stdout.bytes, frame());
    assert_eq!(report.stdout.sha256, pin(&frame()).sha256);
    assert!(report.stdout.complete);
    assert_eq!(report.stderr.bytes, b"");
    let digest = run_with(&controller(), "digest", &AtomicBool::new(false));
    let expected: String = pin(&frame())
        .sha256
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(digest.stdout.bytes, expected.as_bytes());
}
#[test]
fn process_fixed_image_survives_original_path_replacement() {
    let c = controller();
    let permit = synthetic_permit();
    let lease = c.begin(&permit).unwrap();
    let (source, expected) = fixture();
    let path = std::env::temp_dir().join(format!(
        "fusou-native-fixture-{}-{}",
        std::process::id(),
        lease.id
    ));
    let mut temporary = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .unwrap();
    let mut original = source.try_clone().unwrap();
    std::io::copy(&mut original, &mut temporary).unwrap();
    drop(temporary);
    let sealed = prepare_image(&File::open(&path).unwrap(), expected, &lease).unwrap();
    std::fs::remove_file(&path).unwrap();
    let mut replacement = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .unwrap();
    replacement.write_all(b"not an executable").unwrap();
    std::fs::remove_file(&path).unwrap();
    let input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    let arguments = args("echo", &lease);
    let report = launch(
        sealed,
        input,
        arguments,
        lease,
        Containment::DirectSynthetic,
        &permit,
    )
    .unwrap()
    .observe(&AtomicBool::new(false))
    .unwrap();
    assert_eq!(report.exit, Some(Exit::Code(0)));
    assert_eq!(report.stdout.bytes, frame());
}
#[test]
fn process_exit127_signal_and_exec_failure_are_distinct() {
    let report = run_with(&controller(), "exit127", &AtomicBool::new(false));
    assert_eq!(report.exit, Some(Exit::Code(127)));
    assert_eq!(report.exec, ExecReport::NoReportedExecError);
    let report = run_with(&controller(), "signal", &AtomicBool::new(false));
    assert_eq!(report.exit, Some(Exit::Signal(libc::SIGTERM)));
    let c = controller();
    let permit = synthetic_permit();
    let lease = c.begin(&permit).unwrap();
    let mut broken = [0; 64];
    broken[..7].copy_from_slice(b"\x7fELF\x02\x01\x01");
    let mut file = File::from(
        memfd_create(
            "bad-elf",
            MFdFlags::MFD_CLOEXEC | MFdFlags::MFD_ALLOW_SEALING | MFdFlags::from_bits_retain(0x10),
        )
        .unwrap(),
    );
    file.write_all(&broken).unwrap();
    file.set_permissions(std::fs::Permissions::from_mode(0o500))
        .unwrap();
    fcntl(
        &file,
        FcntlArg::F_ADD_SEALS(SealFlag::from_bits_retain(0x2f)),
    )
    .unwrap();
    // Test-only malformed ELF bypasses preparation, not the production policy gate.
    let image = Image {
        file: owned_above_stdio(file).unwrap(),
        pin: pin(&broken),
        has_interpreter: false,
        has_dynamic: false,
        owner: Owner::of(&lease),
    };
    let input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    let arguments = args("echo", &lease);
    let report = launch(
        image,
        input,
        arguments,
        lease,
        Containment::DirectSynthetic,
        &permit,
    )
    .unwrap()
    .observe(&AtomicBool::new(false))
    .unwrap();
    assert_eq!(report.exit, Some(Exit::Code(127)));
    assert_eq!(
        report.exec,
        ExecReport::Failed {
            stage: 3,
            errno: libc::ENOEXEC
        }
    );
}
#[test]
fn process_stdout_stderr_individual_and_total_limits() {
    for (mode, wanted) in [
        ("stdout", Stop::StdoutLimit),
        ("stderr", Stop::StderrLimit),
        ("paired", Stop::TotalLimit),
    ] {
        let mut limits = limits();
        if mode == "paired" {
            limits.stdout_bytes = 12288;
            limits.stderr_bytes = 12288;
            limits.total_capture_bytes = 12288;
        }
        let c = Controller::new(limits, &synthetic_permit()).unwrap();
        let report = run_with(&c, mode, &AtomicBool::new(false));
        assert_eq!(report.stop, wanted, "{report:?}");
        assert!(report.stdout.bytes.len() <= c.limits.stdout_bytes);
        assert!(report.stderr.bytes.len() <= c.limits.stderr_bytes);
        assert!(
            report.stdout.bytes.len() + report.stderr.bytes.len() <= c.limits.total_capture_bytes
        );
        assert!(!report.stdout.complete || !report.stderr.complete);
    }
}
#[test]
fn process_timeout_and_cancel_keep_operation_identity() {
    let mut limits = limits();
    limits.timeout = Duration::from_millis(100);
    let c = Controller::new(limits, &synthetic_permit()).unwrap();
    let report = run_with(&c, "sleep", &AtomicBool::new(false));
    assert_eq!(report.stop, Stop::Timeout);
    assert_eq!(report.exit, Some(Exit::Signal(libc::SIGKILL)));
    let report = run_with(&controller(), "sleep", &AtomicBool::new(true));
    assert_eq!(report.stop, Stop::Cancelled);
    assert_eq!(report.exit, Some(Exit::Signal(libc::SIGKILL)));
}
#[test]
fn process_cloexec_does_not_leak_extra_fd_or_environment() {
    let extra = File::open("/dev/null").unwrap();
    fcntl(&extra, FcntlArg::F_SETFD(nix::fcntl::FdFlag::empty())).unwrap();
    let report = run_with(&controller(), "fds", &AtomicBool::new(false));
    assert_eq!(report.exit, Some(Exit::Code(0)));
    assert_eq!(report.stdout.bytes, b"[0, 1, 2]\n[]\n");
    assert_eq!(fcntl(&extra, FcntlArg::F_GETFD).unwrap(), 0);
}
#[test]
fn process_capture_retains_slot_until_observed_and_never_early_reuses_it() {
    let c = controller();
    let permit = synthetic_permit();
    let lease = c.begin(&permit).unwrap();
    let input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    let arguments = args("echo", &lease);
    let child = launch(
        image(&lease),
        input,
        arguments,
        lease,
        Containment::DirectSynthetic,
        &permit,
    )
    .unwrap();
    assert!(c.begin(&permit).is_err());
    child.wait_for_exit_notification().unwrap();
    assert!(c.begin(&permit).is_err());
    let report = child.observe(&AtomicBool::new(false)).unwrap();
    assert!(report.capture_eof);
    assert!(!report.slot_released);
    assert_eq!(c.state.lock().unwrap().quarantined, 1);
    assert!(sys::retry_quarantined_reaps().is_empty());
}

#[test]
fn all_required_seals_unknown_seals_and_host_denial_remain_fail_closed() {
    for seal in [1, 2, 4, 8, 0x20] {
        assert!(validate_seals(0x2f & !seal).is_err());
    }
    assert!(validate_seals(0x2f | 0x40)
        .unwrap_err()
        .to_string()
        .contains("unsupported"));
    assert!(validate_seals(0x27 | 0x10).is_err()); // FUTURE_WRITE is not WRITE.
    assert!(validate_seals(0x2f).is_ok());
    for error in [
        nix::errno::Errno::EPERM,
        nix::errno::Errno::EACCES,
        nix::errno::Errno::EINVAL,
    ] {
        assert!(
            matches!(memfd_error(error, true), LaunchError::ExecutableMemfd(actual) if actual == error)
        );
    }
    let c = controller();
    let lease = c.begin(&synthetic_permit()).unwrap();
    let mut image = image(&lease);
    assert!(image.file.write_all(b"mutation").is_err());
    let mut input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    assert!(input.file.write_all(b"mutation").is_err());
}

#[test]
fn fd_plan_rejects_stdio_and_all_aliases_before_clone() {
    for index in 0..5 {
        for replacement in [0, 1, 2, -1, 3, 4, 5, 6, 7] {
            let mut fds = [3, 4, 5, 6, 7];
            let previous = fds[index];
            fds[index] = replacement;
            let plan = sys::ChildPlan {
                image: fds[0],
                input: fds[1],
                stdout: fds[2],
                stderr: fds[3],
                error: fds[4],
            };
            assert_eq!(sys::validate_plan(&plan).is_ok(), previous == replacement);
        }
    }
}

#[test]
fn cross_controller_and_cross_operation_inputs_cannot_mix() {
    let a = controller();
    let b = controller();
    let permit = synthetic_permit();
    let lease_a = a.begin(&permit).unwrap();
    let lease_b = b.begin(&permit).unwrap();
    assert_eq!(lease_a.id, lease_b.id); // Same numeric ID is not the same owner.
    let input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease_a).unwrap();
    let arguments = args("echo", &lease_b);
    let result = launch(
        image(&lease_b),
        input,
        arguments,
        lease_b,
        Containment::DirectSynthetic,
        &permit,
    );
    assert!(result.err().unwrap().to_string().contains("owner mismatch"));
    let old = Owner::of(&lease_a);
    drop(lease_a);
    let next = a.begin(&permit).unwrap();
    assert!(old.require(&next).is_err());
}

#[test]
fn process_concurrent_large_capture_is_exact_and_bounded() {
    let mut limits = limits();
    limits.stdout_bytes = 1024 * 1024;
    limits.stderr_bytes = 1024 * 1024;
    limits.total_capture_bytes = 2 * 1024 * 1024;
    limits.drain_bytes = 2 * 1024 * 1024 + 8192;
    let c = Controller::new(limits, &synthetic_permit()).unwrap();
    let report = run_with(&c, "flood", &AtomicBool::new(false));
    assert_eq!(report.stop, Stop::Exited);
    assert_eq!(report.exit, Some(Exit::Code(0)));
    assert!(report.stdout.complete && report.stderr.complete);
    assert_eq!(report.stdout.bytes, vec![b'O'; 1024 * 1024]);
    assert_eq!(report.stderr.bytes, vec![b'E'; 1024 * 1024]);
    assert_eq!(report.stdout.sha256, pin(&report.stdout.bytes).sha256);
    assert_eq!(report.stderr.sha256, pin(&report.stderr.bytes).sha256);
}

#[test]
fn process_read_exhaustion_cannot_claim_eof_or_release() {
    let c = controller();
    let permit = synthetic_permit();
    let lease = c.begin(&permit).unwrap();
    let image = image(&lease);
    let input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    let arguments = args("sleep", &lease);
    let child = launch(
        image,
        input,
        arguments,
        lease,
        Containment::DirectSynthetic,
        &permit,
    )
    .unwrap();
    c.state.lock().unwrap().reads = c.limits.max_reads;
    let report = child.observe(&AtomicBool::new(false)).unwrap();
    assert_eq!(report.stop, Stop::ResourceLimit);
    assert!(report.reaped);
    assert!(!report.capture_eof);
    assert!(!report.tree_cleanup_verified && !report.slot_released);
    assert!(!report.errors.is_empty());
    assert!(c.begin(&permit).is_err());
}

#[test]
fn process_cancel_racing_completed_child_is_single_observation_not_success() {
    let c = controller();
    let permit = synthetic_permit();
    let lease = c.begin(&permit).unwrap();
    let image = image(&lease);
    let input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    let arguments = args("exit127", &lease);
    let child = launch(
        image,
        input,
        arguments,
        lease,
        Containment::DirectSynthetic,
        &permit,
    )
    .unwrap();
    child.wait_for_exit_notification().unwrap();
    let report = child.observe(&AtomicBool::new(true)).unwrap();
    assert_eq!(report.stop, Stop::Cancelled);
    assert_eq!(report.exit, Some(Exit::Code(127)));
    assert!(report.reaped && report.capture_eof);
    assert!(!report.slot_released);
    assert_eq!(c.state.lock().unwrap().quarantined, 1);
}

#[test]
fn process_cancel_during_capture_kills_and_reaps_only_its_task() {
    let c = controller();
    let cancel = AtomicBool::new(false);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            std::thread::sleep(Duration::from_millis(100));
            cancel.store(true, std::sync::atomic::Ordering::Release);
        });
        let report = run_with(&c, "sleep", &cancel);
        assert_eq!(report.stop, Stop::Cancelled);
        assert_eq!(report.exit, Some(Exit::Signal(libc::SIGKILL)));
    });
}

#[test]
fn process_drain_work_limit_never_fabricates_full_capture() {
    let mut limits = limits();
    limits.drain_bytes = 4096;
    let c = Controller::new(limits, &synthetic_permit()).unwrap();
    let report = run_with(&c, "flood", &AtomicBool::new(false));
    assert_eq!(report.stop, Stop::DrainLimit);
    assert!(report.stdout.seen + report.stderr.seen <= 4096);
    assert!(!report.stdout.complete && !report.stderr.complete);
    assert!(!report.capture_eof);
}

#[test]
fn process_dropped_handle_retains_slot_and_quarantine_reaps_task() {
    let c = controller();
    let permit = synthetic_permit();
    let lease = c.begin(&permit).unwrap();
    let image = image(&lease);
    let input = prepare_input(&frame(), pin(&frame()), &fd_limits(), &lease).unwrap();
    let arguments = args("sleep", &lease);
    let child = launch(
        image,
        input,
        arguments,
        lease,
        Containment::DirectSynthetic,
        &permit,
    )
    .unwrap();
    drop(child);
    assert!(c.begin(&permit).is_err());
    assert_eq!(c.state.lock().unwrap().quarantined, 1);
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        assert!(sys::retry_quarantined_reaps().is_empty());
        if sys::quarantined_task_count() == 0 {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "synthetic task remains quarantined/unreaped"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
    assert!(c.begin(&permit).is_err()); // Reap recovery is not a tree-cleanup authorization.
}
