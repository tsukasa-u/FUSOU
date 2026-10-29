# Linux native launch substrate: decision B

## Status and scope

**Decision: B. Mechanisms implemented; kernel delegation validation BLOCKED.
Overall implementation: PARTIAL, synthetic-only. Provider: NOT_IMPLEMENTED.**

The lifecycle/bridge follow-up starts at
`643315e00c303135b4aebde78a32e30f4e3d2ea1` (parent `89d940d...`), on
`tlsn-first-testplay-candidate`. Section G records this follow-up separately
from the original implementation and historical results below.

Implementation baseline: branch `tlsn-first-testplay-candidate`, HEAD
`89d940d40b42955bdce24cee3d85643870ae69e3`, parent
`4e767539076fb32e1de83a31ac0168f3a48e5dd2`. That HEAD existed before this
implementation; it is not a new commit created by this work.

The user explicitly authorized a minimal unsafe/FFI boundary in a dedicated
crate, offline dependency resolution, synthetic process tests and this record.
That authorization is **not** provider, signer, builder, runtime or resource
policy authorization.

## A. Purpose and threat model

The Linux backend must bind an independently admitted executable image, owned
input, supervised task and bounded capture to one operation. This is OS
execution management, not TLSN verification or cryptographic proof of execution.

Responsibilities remain separate:

* The TLSN verifier validates Presentation/Result, approved observed DNS identity,
  authorities, Target Approval and transcript-derived evidence.
* Independent artifact/attestation verification validates distribution provenance
  and independently authorized signer/builder policy.
* The substrate prepares sealed FDs, starts a task, drains output and retains
  ownership through termination/cleanup. It must not manufacture either of the
  above cryptographic conclusions.

The development host/kernel is not assumed compromised in these mechanism
tests. Runtime identity and provider-captured output are not remote attestation
of a compromised host, nor independent third-party evidence verification.
Browser integrity and APP process/image authority remain OUT_OF_SCOPE; no TPM,
measured boot, privileged helper or process attestation is introduced.

## B. Reproducible investigation history

Commit messages are navigation aids, not design specifications. The evidence
below is scoped source/diff inspection plus the indicated historical reports.
Historical PASS counts are **based on past reports**, not current reruns unless
explicitly identified in section E.

| Commit / investigation | Source change or finding | Validation classification |
|---|---|---|
| `5b0dba555148081ef5c05981b1188ecde6aa02ef` | Added resource lifetime/work/JSON/concurrency scope in `release-native-resources.mjs`. | Source history OBSERVED; historical test command/count not reconstructed here. |
| `20b8758895ed5bc4237bed249b4643accde29f44` | Owner-bound disposal, resource lifecycle and regressions; no authorization issuer. | Scoped history OBSERVED; no separate historical PASS count asserted. |
| `49e9512e8ea5610969057c1b79afcf90a9704278` | `offlineLayout` changed manifest descriptors from incorrect `sha256` to `artifact_sha256`; receipt inventory still uses `sha256`. Segment-tree destination checks reject duplicate/file-directory conflicts. | Exact scoped implementation diff OBSERVED. No invented historical test command/count. |
| `9d94d8ded62ffc996cb1f3dda76156a0df793549` | Owned non-shared Node snapshots, admission before copying, strict UTF-8/decoded-key JSON, bounded records and callback ownership/lifetime. | Scoped diff OBSERVED; no native execution implied. |
| `041c1f193e7faecf2a989402db4b0ec362eb377d` | FD ABI v1 serializer/shared vector, owned Rust parser/sealed positional reader, common bytes loader and explicit FD/path CLI separation. | Historical initial Rust compile NOT_CHECKED. Historical Node report: 441 PASS / 1 FAIL across 11 suites; consumer expectation mismatch remained. Not rerun as an old checkout. |
| `74da0853a91f3831738944db50e9d1feb6d93bb8` | Scoped-hook protected-path list adjusted with user authorization for verifier WASM source review. | Historical report: hook tests 14 PASS. |
| `4e767539076fb32e1de83a31ac0168f3a48e5dd2` | Formatter-only WASM wrapper/test setup change; not a native-only cfg bypass. | Historical report: GNU `cargo check --lib --bins` PASS; selected Rust FD 9 + JSON 2 + CLI 2 = 13 PASS. WASM target NOT_CHECKED. |
| `89d940d40b42955bdce24cee3d85643870ae69e3` | Consumer structured blocked contract explicitly initializes `authenticated: false`; ordinary errors still reject. Shared vector mutations and path acquisition/CLI regressions added without relaxing production checks. | Historical baseline 66 PASS / 1 FAIL; explicit-auth regression 1 PASS / 1 FAIL; final Node 117 PASS, selected Rust 20 PASS, GNU check PASS. |
| Safe-API investigation at `89d940d...` (no commit) | Locked nix 0.30.1 safe `execveat` replaces caller; safe `posix_spawn` selects a path; `fork` is unsafe. Inherited integer-FD adoption is another unsafe boundary. | BLOCKED under then-current no-unsafe constraint. No code change, tests or synthetic launch. |
| A/B/C design investigation at the same HEAD (no commit) | B provisionally selected, requiring explicit localized unsafe authorization. | Source/documentation investigation only; no runtime success asserted. |

Historical command forms recorded in the previous validation reports:

```sh
node --test --test-reporter=spec scripts/release-consumer.test.mjs scripts/release-offline-fd.test.mjs scripts/release-checks.test.mjs
cargo metadata --format-version 1 --locked --offline --filter-platform x86_64-unknown-linux-gnu
cargo check --locked --offline --package fusou-tlsn-verifier --target x86_64-unknown-linux-gnu --lib --bins --jobs 2
cargo test --locked --offline --package fusou-tlsn-verifier --target x86_64-unknown-linux-gnu --lib --bin verify_fusou_tlsn_evidence --jobs 2 -- offline_fd::tests strict_json::tests evidence_bundle::tests::acquisition:: tests::fd_mode_is_explicit_and_excludes_all_other_arguments tests::legacy_duplicate_flags_are_rejected tests::legacy_path_modes_preserve_all_arguments_and_optional_sparse_profile tests::unsupported_flags_and_fd_mixing_never_select_legacy_execution
```

These are workspace-relative renderings, not claims to have rerun each
historical checkout. Original absolute-path environment/command logs remain
in the investigation reports. Unknown historical results are not inferred.

## C. Alternatives

| Criterion | A: path-spawn launcher, then FD exec | B: dedicated unsafe crate, direct FD child | C: immutable namespace path exec |
|---|---|---|---|
| Same image FD | Launcher must retain/recheck received FD | Parent-owned sealed FD copied into child and used by `execveat` | Not intrinsically FD-identical; requires immutable inode/path proof |
| Supervised child | Safe `posix_spawn`, same PID after exec | `clone3(CLONE_PIDFD)` creates owned child/pidfd | Safe path spawn after namespace admission |
| Launcher trust root | New launcher distribution, digest, path pin, runtime and independent registration | No additional path-started launcher; containing parent/component still needs independent bootstrap | Namespace creator and any launcher also require trust |
| Path / TOCTOU | Hash then spawn is insufficient; launcher path needs immutable authority | No image pathname at exec; no `/proc/self/fd` substitution or reopening | Exclude writable aliases/FDs/mappings and mutable mount topology; chmod/read-only bind alone insufficient |
| FD ownership | File actions can map FDs, but inherited raw FD -> Rust ownership is a separate boundary | Owned descriptors normalized above stdio, explicit 0/1/2 mapping, CLOEXEC remainder | FD-native stdin remains possible; does not solve executable namespace proof |
| Post-fork safety | Launcher normally starts a fresh runtime, but still needs FD adoption/exec design | Strict nonallocating child path; prepared C strings/pointer arrays; fixed error pipe | Depends on creator/spawn method; namespace construction is additional work |
| Capture / timeout / descendants | Parent capture still needs whole-tree containment and cleanup | Same requirement; pidfd is task identity, not tree containment | Same requirement, not solved by filesystem immutability |
| Host permissions | Immutable launcher path plus delegated containment | Required syscalls/memfd policy; separately admitted delegated containment | Mount/user namespaces, filesystem closure, host permissions plus containment |
| Runtime dependency closure | Launcher and target separately | Parent/component and target still need closure | Creator/launcher, filesystem/mount closure and target |
| Code / maintenance | Extra distributed executable and bootstrap boundary | Small explicit OS/unsafe review boundary; nontrivial lifecycle work | Largest namespace/filesystem/permission configuration surface |

### Why B

The locked safe APIs do not combine supervised child creation with FD-selected
execution. A adds a launcher whose path, pin, runtime and registration root were
not established; inherited FD ownership also remained unresolved. C adds
immutable filesystem/namespace and privilege conditions not demonstrated here.

B concentrates the necessary OS calls, FD adoption and exec-failure protocol
in one inspectable crate without starting a second trusted pathname. Explicit
user authorization now permits that boundary. It does **not** authorize a
provider or eliminate unsafe review, runtime closure, resource policy, cgroup
delegation or independent bootstrap requirements.

## D. Implemented contracts

### Placement and capability

[`native-launch/`](native-launch/) is a workspace member. Dependency direction
is `native-launch -> fusou-tlsn-verifier`; the verifier does not call the launcher.
The verifier's manifest `unsafe_code = "forbid"` and library
`#![forbid(unsafe_code)]` remain unchanged.

The new crate denies unsafe except in [`sys.rs`](native-launch/src/sys.rs) and
denies `unsafe_op_in_unsafe_fn` throughout. Every unsafe block documents its
preconditions. The OS mechanism and safe facade are private. Only `cfg(test)`
can create a synthetic `Permit`. The public registered-context request
unconditionally returns `FD_POLICY_CONTEXT_NOT_REGISTERED`. No Cargo feature,
caller boolean, `APPROVED` marker or public synthetic constructor bypasses it.

No separate launcher binary or Node bridge is added. The fixed example is a
synthetic target only; the tests read its ELF bytes, never execute its path.

### Prepare, seal and compare independent expectations

[`prepare.rs`](native-launch/src/prepare.rs) separates `Image` and `Input`.

* Image: bounded positional copying into `MFD_EXEC | MFD_ALLOW_SEALING |
  MFD_CLOEXEC`; mode `0500`; immutable WRITE/GROW/SHRINK/SEAL/EXEC seals.
  Length/SHA-256 of the **sealed FD** must match supplied expectations.
  Only x86-64 little-endian ELF is admitted by this synthetic preparation path;
  ELF program table bounds are checked and interpreter/dynamic markers retained.
  This is not a full ELF validator or interpreter/DT_NEEDED closure verifier.
* Input: `MFD_NOEXEC_SEAL`, mode `0400`, the separate immutable/noexec seal
  contract, exact length/hash, then existing `read_sealed_file`/FD ABI v1 parsing.
  Pipes/sockets/ordinary or insufficiently sealed files, unknown seals and
  invalid modes fail closed. FUTURE_WRITE does not substitute for WRITE.
* Each owned image, input and argument set carries controller identity and
  operation ID. Numeric ID equality across controllers is not ownership.
* Positional reads do not depend on the shared open-description cursor.
  FD 0 inherits that description; consumers must use the ABI's positional reader,
  not assume a freshly rewound ordinary stdin stream.
* Expected pins in tests are **fixture-only** hashes of the explicitly compiled
  probe. They are not independent authorization or a registered image policy.

No retry with weaker memfd flags, path fallback or host policy change occurs.
Executable memfd creation refusal is surfaced distinctly. Actual host-denial
policy was not installed/tested; errno classification tests are not that proof.

### Child OS boundary

The parent prepares CStrings, argv/envp pointer arrays, distinct source FDs
above 2, capture pipes and error pipe before `clone3`. Arguments are owned and
bounded and restricted to the fixed probe name/modes; the environment is cleared except for an explicit synthetic operation
variable allowlist. Loader variables, PATH and inherited credentials are not
passed as environment entries; this is not credential/namespace isolation.

`clone3(CLONE_PIDFD, SIGCHLD)` uses separate address/FD tables, without CLONE_VM,
CLONE_FILES, CLONE_THREAD, custom stack or libc at-fork callbacks. Child code
only maps stdin/stdout/stderr, sets `close_range(CLOEXEC)` for all other FDs,
and issues raw `execveat(image_fd, "", ..., AT_EMPTY_PATH)`.
There is no `pre_exec`, `posix_spawn`, unsafe `fork` wrapper or exec-path fallback.
Required syscall refusal is an error, not a feature downgrade.

The child neither returns through Rust callers nor runs destructors. It does
not allocate, lock, log or use nix's allocating `to_exec_array` wrapper.
Fixed stack bounds and live parent-prepared pointers are the safety contract.
On failure it writes a 16-byte `FLX1`/stage/errno record and calls `_exit(127)`.
Parent code distinguishes that record from the target's own exit 127/signal.
EOF alone is named **NoReportedExecError**, not authenticated execution proof.
Parent pins, process exit, capture and cleanup remain separate observations.

Owned pidfd addresses both termination and safe nix `waitid(P_PIDFD)` reaping.
Numeric PID is diagnostic only; a recycled PID is not used to select a task.
The embedding parent must not independently steal this child's wait status or
set incompatible SIGCHLD auto-reap behavior; uncertainty blocks settlement.

### Capture and resource ownership

[`supervise.rs`](native-launch/src/supervise.rs) uses nonblocking pipes and a
fair bounded poll/drain loop for stdout, stderr and the exec-error channel.
It limits individual/combined retained output, drained work and read calls,
and records stream digests, counts, EOF, exit/signal and operation ID.
A partial/discarded stream cannot claim a complete captured digest/archive.

Deadline, cancellation, output/resource overflow and supervision errors cause
task termination and bounded reap/drain attempts. Cancellation observed before
settlement wins over an as-yet-unobserved completion; it does not fabricate a
different exit status. Consuming the child handle prevents double observation.

Reservations distinguish image, input, FD preparation, execution, capture and
cleanup. Failed work is not refunded. Parser reads reserve their own maximum
before invocation. These are conservative modeled work/retention budgets, not
peak-RSS guarantees or an approved process-global/shared issuer.

Explicit safe `close` results for parent handoff FDs, capture FDs and reaped
pidfd participate in the cleanup observation. On failure/drop, the lease
retains its occupied slot. An unreaped direct task is stopped and retained in
an in-process quarantine registry, with an explicit bounded reap-retry method;
dropping the handle does not detach it or claim cleanup. Recovery of a direct
task does not authorize slot release. Registry lifetime is process-local, not
durable cleanup across parent/kernel failure.

### Cgroup boundary: deliberately incomplete

There is **no admitted delegated subtree/no-escape root**, no cgroup factory
and no automatic reuse of an existing user/IDE/shared cgroup.
`require_delegated_containment()` rejects before launching.

At `643315e...`, cgroup placement/kill/events were private hooks only.
The follow-up implements private root validation, exclusive leaf creation,
credential separation and ordered disposal, as described in section G.
Actual delegated placement/no-escape/descendant cleanup remains BLOCKED, not
validated by fake adapters. An empty event file alone cannot release a slot.
No shared cgroup is created, modified, moved into or killed by these tests.

Direct-synthetic mode is constructible only behind the test permit; it is not
a fallback for failed containment. Its process-tree cleanup is always
unverified and its slot is always quarantined, even after exit, EOF and FD close.
PIDFD/direct-child success is never promoted to descendant cleanup success.

## E. Original implementation verification (historical)

This section records the previous `643315e...` implementation report, not
new runs of those commands. Use section G for current results and selectors;
an unfiltered native test run now also selects an explicitly configured IPC
peer and is not the ordinary unit-test command.

Toolchain: Rust 1.98.1 (`48a229cea`); GNU target
`x86_64-unknown-linux-gnu`. Exact cached nix 0.30.1 and libc 0.2.190.
The lock update adds only this local package; no existing dependency versions
or checksums change. New nix features are local fs/poll/process/signal
requirements. There is no new external build script; all 57 build-script/
proc-macro identities match the previously inspected graph.

Use an empty HOME, isolated offline Cargo home/target and direct toolchain.
Do not copy credentials/configuration. Existing registry/git caches can be
reused; MPZ checkout must be privately copied because its existing circuit-data
build script writes source data. No dependency download is required/allowed.

From this workspace, with `CARGO_TARGET_DIR` set to that private target:

```sh
cargo metadata --format-version 1 --locked --offline --filter-platform x86_64-unknown-linux-gnu
cargo check --locked --offline --package fusou-tlsn-native-launch --package fusou-tlsn-verifier --target x86_64-unknown-linux-gnu --lib --bins --examples --jobs 2
cargo build --locked --offline --package fusou-tlsn-native-launch --target x86_64-unknown-linux-gnu --example synthetic_probe --jobs 2
FUSOU_SYNTHETIC_PROBE="$CARGO_TARGET_DIR/x86_64-unknown-linux-gnu/debug/examples/synthetic_probe" cargo test --locked --offline --package fusou-tlsn-native-launch --target x86_64-unknown-linux-gnu --lib --jobs 2
```

The initial, deliberately offline metadata resolution omitted `--locked` only
to add the authorized local package to Cargo.lock; subsequent checks/tests use
both `--locked --offline`. The original ABI specification/vector were unchanged.

Current results:

| Selection | Result / scope |
|---|---|
| Native GNU library/bins/example check | PASS; compile only, no operational CLI execution |
| Dedicated crate | 25 tests: 12 preparation/unit + 13 direct-synthetic-process cases; no ignored tests |
| Existing verifier selections | FD 10 + strict JSON 2 + acquisition 4 + CLI parser 4 = 20 PASS; other 92 library tests not selected |
| Node consumer / FD / release-check | 18 + 53 + 46 = 117 PASS |
| Delegated cgroup / descendant escape or survivor cases | BLOCKED, NOT EXECUTED; no explicit safe delegation; no test skip presented as PASS |
| Actual executable-memfd-denial host policy | UNVERIFIED; refusal/error classification only |
| Actual verifier / gh / attestation / TLSN evidence execution | NOT EXECUTED |

The process cases cover exact FD 0 bytes/digest, source-path removal/replacement,
concurrent 1 MiB per stream with exact digests, individual/combined capture caps,
drain/read exhaustion, timeout, immediate/in-flight/completion-racing cancel,
exit 127 versus exec errno, signal binding, inherited-FD/environment exclusion,
pending capture slot retention and dropped-handle quarantine/reap.

During development, formatter/check initially failed on two misplaced helper
items; the first test compile also found an attempted private parser-field
access. These were corrected, not skipped. The parser API was not widened:
the shared-vector test uses its public binding and committed header bytes.
Staged review also identified unmetered ELF header `read_exact_at` calls;
they were replaced with the controller-bounded positional reader (including
interrupted calls) and an exhaustion assertion. No failing assertions were relaxed.

## F. Remaining gates

| Item | Status | Missing evidence / implementation |
|---|---|---|
| Localized OS boundary and direct synthetic execution | IMPLEMENTED | Limited to tested Linux x86-64 host; not an authorized provider |
| Sealed image/input mechanism | IMPLEMENTED (synthetic) | Independent image policy and formal native input identity still absent |
| Capture/deadline/cancel/direct reap/quarantine | IMPLEMENTED (synthetic) | Whole-tree kernel validation remains BLOCKED |
| Delegated cgroup lifecycle/no escape/disposal | IMPLEMENTED in private source / runtime BLOCKED | Root/leaf validation, atomic placement, credential drop and removal exist; actual delegated/no-escape/descendant cases have not run |
| Node resource controller integration | IMPLEMENTED (mechanical, unapproved) | Unix-stream identity/reservation/state bridge; fake cleanup and actual direct synthetic IPC tested; no registered provider/peer authorization |
| Resource policy/shared budget issuer | NOT_IMPLEMENTED | Fixture limits and independent controllers are not global admission |
| musl static runtime profile | UNVERIFIED | Recipe remains GNU; musl dependency build/linker/sysroot/build-script closure not tested |
| Actual ELF interpreter/DT_NEEDED/runtime closure | UNVERIFIED | Synthetic header markers are not a verified dependency distribution |
| Independent bootstrap/provider registration | NOT_IMPLEMENTED | No install/update/revocation root or registration factory |
| Signer/trusted builder authorization | UNAPPROVED | No local pin/flag supplies independent authorization |
| Real native input identity integration | BLOCKED | No registered Node -> real verifier -> capture/evidence roundtrip |
| Actual attestation / TLSN evidence verification | UNVERIFIED | Not executed in this task |
| gh exact distribution/pin/network/CA/DNS/TUF/credentials | UNVERIFIED / UNAPPROVED | Separate online profile, not covered by this synthetic ELF |
| Production acceptance | BLOCKED | Real Game Server/Notary/deployment/gameplay and independent real evidence acceptance remain required |

Next work requires an independently admitted delegation/no-escape configuration
and resource/registration root. Test actual operation-private placement before
exec, descendant fork/exit/escape, cgroup.kill, empty confirmation, capture EOF,
FD close and directory removal. Do not weaken to PID/process-group cleanup.
The mechanical bridge does not supply bootstrap, peer authentication,
runtime/image admission or a shared budget issuer. Do not enable the formal
consumer as part of mechanism tests.

The following trust states remain unchanged:

```text
Executable identity: BLOCKED
Runtime dependency closure: UNVERIFIED
Offline input integrity: BLOCKED
Actual attestation verification: UNVERIFIED
Signer / trusted builder authorization: UNAPPROVED
Provider bootstrap / registration: NOT_IMPLEMENTED
authenticated: false
publication_authorized: false
deployment: NOT_CHECKED
Production acceptance: BLOCKED
```

## G. Delegated lifecycle and Node bridge follow-up

### Environment and authority

Observed for this follow-up: supervisor UID/GID **1000/1000**;
`FUSOU_SYNTHETIC_CGROUP_PARENT` **unset**. There is no explicitly approved private
delegated subtree, and the selected UID/GID-switch authority is absent.
Consequently **all real cgroup/credential/descendant integration is BLOCKED,
NOT EXECUTED**. No shared cgroup or host policy was changed to obtain a test.
No conditional test silently returns or reports a fake kernel PASS.

The user selected a distinct non-root child UID/GID, capability removal and
no-new-privileges. The source requires a root supervisor with effective
CHOWN/SETUID/SETGID/SETPCAP and supported securebits before filesystem mutation.
After atomic clone placement, the child uses raw credential syscalls, not
libc's multithreaded setxid coordination: clear supplementary groups, set all
real/effective/saved IDs, clear ambient/permitted/effective/inheritable and
bounding capabilities, and set NNP before exec. IDs/groups/capability sets/NNP
are checked. These operations remain exclusively in the dedicated unsafe
`sys.rs`; the verifier still forbids unsafe.

An absolute, explicitly supplied root is opened component by component with
NOFOLLOW/directory/CLOEXEC descriptors. It must be a non-root cgroup2 domain;
memory/pids must already be enabled. Root/ancestors and migration controls
must be root-owned and not group/world writable. This deliberately rejects
ordinary same-UID writable delegation. There is no subtree_control write.
These checks do **not** prove administrative delegation, dedicated account
allocation, stable mount/admin policy, absence of a privileged migration
service, or independent resource approval. A trusted kernel/admin and no
hostile administrative permission changes remain external conditions.
UID/GID, numeric limits and environment settings are not authorization.

Each operation exclusively mkdirs a 128-bit random-suffixed leaf (random
identifier, not cryptographic key material); existing leaves are never reused.
Only that leaf receives memory.max/pids.max writes. Anchored parent/leaf FDs,
device/inode identity, kill/events FDs and operation owner remain retained.
`clone3(CLONE_PIDFD | CLONE_INTO_CGROUP)` uses that leaf FD from birth: there
is no post-spawn placement race, path exec, process-group or direct-only
fallback. Unsupported kernel/permissions reject. Root validation and all
successful kernel paths are compile-checked but have **not** run here.

### State and cleanup ownership

The state machine and the shared real/fake cleanup callback distinguish:

```text
PREPARING -> CHILD_CREATED -> EXEC_OBSERVED -> CAPTURING
                                    -> STOPPING -> REAPED -> TREE_EMPTY
                                    -> CAPTURE_COMPLETE -> CLEANUP_CONFIRMED
failure/unknown -----------------------------------------> QUARANTINED
```

STOPPING is also allowed before exec and before child creation. Duplicate,
reversed, unknown or terminal transitions fail closed; an invalid cleanup
entry cannot invoke the adapter. EXEC_OBSERVED means error-pipe EOF without
a reported exec error, **not** authenticated execution or cryptographic proof.

The supervisor fixes timeout/cancel/output failure, requests cgroup.kill when
stopping (including natural direct-child exit with possible descendants),
reaps the direct child and polls bounded cgroup.events until empty or cleanup
deadline. Concurrent capture drain remains bounded. It checks all capture/error
EOF and explicit parent FD closes, then verifies empty/leaf identity, closes
leaf control FDs, removes the leaf and confirms ENOENT. Only the complete
successful cleanup chain releases the native lease. PIDFD/reap/kill alone do
not establish whole-tree success. Errors or missing facts retain ownership and
quarantine the slot; partially prepared leaves also retain their owner.

Prelaunch bridge/group preparation marks cleanup pending, so dropping a failed
attempt cannot return a slot while native resources may remain. Existing
direct-synthetic mode remains test-only and **always quarantined**. Cgroup and
unreaped-task quarantine retain handles; there is no automatic cgroup
quarantine recovery or administrative unquarantine API in this change.
Actual descendant termination/no-escape, zombie handling by the host, permission
changes, removal races and kernel close/error behavior remain unverified.
The eventual supervisor's inherited signal dispositions/mask and runtime
profile also require admission/review; these tests do not establish safe
bootstrap inside an arbitrary privileged application runtime.

### Node/native boundary

There was no existing production native invocation or Node operation ID to
connect: `captureOfflineExecution` accepts only its mockExecutor and rejects
production execute; intake authenticates cross-run records, not local children.
Those gates and the consumer remain unchanged.

The mechanical bridge uses a supplied Unix stream, not a new launcher binary,
N-API/IPC dependency or provider factory. Node's branded scope issues a unique
controller/operation ID and reserves image/input/FD/execution/capture/stop/
cleanup modeled work plus read/capture counts **before START**. A native hold
is additional to pending callbacks; scope close/caller cancellation cannot
release it. Invalid reservations themselves quarantine the attempted hold.
The bridge retains managed completion eagerly, including synchronous caller
abort, until final cleanup and channel close or bounded failure.

START carries the ID and reservation. Rust binds these to the exact native
lease owner/ID, requires a fresh exclusively owned controller, and applies
per-stage/read ceilings in addition to its local limits. Independent Rust/Node
controllers are **not** a global/shared approved budget. Native stage counters
remain spent; there is no refund on failure. Usage is modeled work (including
up-front capture reservations), not measured peak RSS or a hard process-global
FD/memory limit.

Private-leaf creation reserves FD/stop/cleanup work before mkdir. Every bounded
events read consumes a read and 4096 cleanup work units before I/O, including
the final empty recheck before removal. Exhaustion quarantines instead of
performing unbudgeted successful cleanup. A fake memfd events adapter checks
this threshold; it is not kernel containment evidence. Real admission must
reserve enough for its chosen cleanup deadline/polling, not reuse small fake
protocol fixtures as production policy.

Version-1 newline JSON events contain exactly native_id, operation_id, outcome,
sequence, state, usage and version. Top-level canonical reserialization rejects
duplicate/aliased keys, whitespace/number aliases and unexpected fields; only
fixed ASCII states/IDs and bounded numeric usage are accepted. Rust control
parsing reuses the verifier's bounded strict JSON parser. START is bounded to
2048 bytes/two seconds, CANCEL to 256 bytes/one command; event frames are
1024 bytes, at most 16 frames/16384 total bytes. Node charges a conservative
65536 work units for protocol processing. The two possible control writes are
bounded; write buffering is not completion. An explicit cleanupTimeoutMs
is required (fixture/admission input, not a newly approved resource policy).

Only a matching, ordered CLEANUP_CONFIRMED with bounded usage **and channel
close** clears Node's hold. Execution outcome FAILED is distinct from confirmed
cleanup: a failed/cancelled operation can eventually free a slot only after
cleanup, never return successful evidence. Unknown IDs, changed native IDs,
duplicate completion, malformed/truncated/disconnected/over-limit transport
and unconfirmed cleanup quarantine. Stale closures cannot decrement another
operation's counter. Cancel sends control and returns promptly while its owned
completion stays pending; deadline/disconnect retains quarantine.

The stream is an explicit host-owned mechanical channel, **not an
independently authenticated peer or proof**. Its diagnostic result is
UNAPPROVED, authenticated=false and publication_authorized=false. It cannot
mint the existing executionProof or enable the production consumer. A future
registered provider must independently admit the peer/launch path; accepting
caller-supplied JSON as production execution authority remains forbidden.

### Current validation (not historical)

No dependency was downloaded and Cargo.lock is unchanged. nix 0.30.1 adds only
the user feature for safe parent UID/chown APIs; existing serde_json moves from
dev to runtime dependency for framing. Target-filtered metadata has the same
55 unique build-script/proc-macro package identities as the prior GNU metadata.
An initial comparison used mismatched platform filters and saw Windows/WASI
packages; the identical GNU filter resolves the discrepancy without lock edits.

Use the isolated empty-HOME/offline-cache environment described in section E.
The MPZ checkout is copied privately; registry/git caches are reused read-only.
With that environment, the complete command arguments are:

```sh
cargo metadata --filter-platform x86_64-unknown-linux-gnu --locked --offline --format-version 1
cargo check -p fusou-tlsn-native-launch -p fusou-tlsn-verifier --target x86_64-unknown-linux-gnu --lib --bins --examples --locked --offline --jobs 2
cargo build -p fusou-tlsn-native-launch --example synthetic_probe --target x86_64-unknown-linux-gnu --locked --offline
cargo test -p fusou-tlsn-native-launch --lib --target x86_64-unknown-linux-gnu --locked --offline -- tests::
cargo test --locked --offline --package fusou-tlsn-verifier --target x86_64-unknown-linux-gnu --lib --bin verify_fusou_tlsn_evidence --jobs 2 -- offline_fd::tests strict_json::tests evidence_bundle::tests::acquisition:: tests::fd_mode_is_explicit_and_excludes_all_other_arguments tests::legacy_duplicate_flags_are_rejected tests::legacy_path_modes_preserve_all_arguments_and_optional_sparse_profile tests::unsupported_flags_and_fd_mixing_never_select_legacy_execution
FUSOU_NATIVE_BRIDGE_TEST_PEER="<compiled native lib test harness>" FUSOU_SYNTHETIC_PROBE="<compiled synthetic_probe>" node --test scripts/release-native-resources.test.mjs scripts/release-native-launch-bridge.test.mjs scripts/release-native-launch-peer.test.mjs scripts/release-consumer.test.mjs scripts/release-offline-fd.test.mjs scripts/release-checks.test.mjs
node --check scripts/release-native-resources.mjs
node --check scripts/release-native-launch-bridge.mjs
node --check scripts/release-native-launch-bridge.test.mjs
node --check scripts/release-native-launch-peer.test.mjs
```

The harness path is printed by the selected cargo test command; no production
verifier executable is used as the IPC peer. The Node peer suite explicitly
selects `--exact ipc_peer::serve --nocapture` with a private test socket/mode.
These variables configure tests only, not public policy registration.

| Selection | Current result |
|---|---|
| Native selected tests | 35 PASS = prior 25 + cgroup parsing/refusal/budget adapter 3 + lifecycle 4 + bridge/cleanup adapters 3 |
| Verifier safe parser/acquisition selections | 20 PASS = FD 10 + strict JSON 2 + acquisition 4 + CLI parser 4 |
| Node resource / bridge / IPC peer | 20 + 21 + 9 PASS |
| Node consumer / FD / release-check | 18 + 53 + 46 PASS |
| Real Rust/Node IPC | 7 fake-cleanup cases plus 2 actual direct-synthetic/cancel cases; direct cases quarantine, not tree PASS |
| Actual cgroup creation/placement/no-escape/descendants/empty/removal | BLOCKED, NOT EXECUTED |

During development, compiler E0499 exposed overlapping mutable ID-array
references; destructuring fixed the pointer preparation. Test-count checking
found three tests nested inside a function; they were moved to a discovered
test module (31 initially, 34 after correction). Cross-language direct tests
also rejected an insufficient input-work reservation: the fixture now reserves
the existing parser's conservative max_json_bytes * max_entries * 16 ceiling,
without changing the parser, assertions or admitted production limits. The
same immediate-abort test exposed an unowned late-rejecting cleanup promise;
the native hold now registers it eagerly. All failures were retained in logs;
none were skipped or weakened.

Kernel acceptance still requires an explicitly administered dedicated root,
dedicated non-root account and switching capabilities, then actual atomic
placement/procs observation, attempted escape, descendant kill/direct reap,
populated=0, capture EOF, FD closure/removal and final slot release tests.
No automatic kernel fixture or host setup is supplied in this environment.
Runtime closure, peer/bootstrap registration, signer/builder and shared resource
issuer authorization, real native input/evidence integration and Production
acceptance remain separate gates. Choosing B still avoids A's launcher trust
root and C's filesystem/namespace closure; it solves neither of these gates.

## References

* [FD ABI v1](FD-ABI-V1.md), [fixed shared vector](fixtures/offline-fd-v1-vector.json).
* [nix 0.30.1 execveat](https://docs.rs/nix/0.30.1/nix/unistd/fn.execveat.html),
  [spawn](https://docs.rs/nix/0.30.1/nix/spawn/fn.posix_spawn.html).
  The cached version's wrapper allocates pointer vectors; it is not used after clone.
* [clone/clone3](https://man7.org/linux/man-pages/man2/clone.2.html),
  [execveat](https://man7.org/linux/man-pages/man2/execveat.2.html),
  [seals](https://man7.org/linux/man-pages/man2/F_ADD_SEALS.2const.html).
* [Kernel executable-memfd policy](https://docs.kernel.org/userspace-api/mfd_noexec.html),
  [cgroup v2 delegation/kill](https://docs.kernel.org/admin-guide/cgroup-v2.html).
* [Rust Unix process source](https://doc.rust-lang.org/1.98.1/src/std/os/unix/process.rs.html),
  [FD ownership](https://doc.rust-lang.org/1.98.1/src/std/os/fd/owned.rs.html).
  These documentation references are not executable artifact authentication.
