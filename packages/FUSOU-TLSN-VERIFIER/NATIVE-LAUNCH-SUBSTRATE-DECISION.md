# Linux native launch substrate: decision B

## Status and scope

**Decision: B. Mechanisms implemented; kernel delegation validation BLOCKED.
Overall implementation: PARTIAL, synthetic-only. Provider: NOT_IMPLEMENTED.**

The lifecycle/bridge follow-up starts at
`643315e00c303135b4aebde78a32e30f4e3d2ea1` (parent `89d940d...`), on
`tlsn-first-testplay-candidate`. Section G records this follow-up separately
from the original implementation and historical results below.

The privilege/recovery follow-up starts at
`d7ec9c5cdaab761e2a30fba701982477ccd15eb0`, parent
`643315e00c303135b4aebde78a32e30f4e3d2ea1`, on the same branch.
Section H records its audit, deliberately non-releasing recovery assessment
and current validation. Section G's results are historical.

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
explicitly identified as a current rerun in section H.

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

There is **no admitted delegated subtree/no-escape root**, no formal cgroup factory
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
new runs of those commands. Use section H for current results and section G for
the historical lifecycle selectors;
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

Results at the original implementation:

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
| Quarantine inspection/recheck | IMPLEMENTED (assessment only) | Owner/revision checks retain occupied slots; a joined OS cleanup owner and exactly-once cross-language release reconciler are NOT_IMPLEMENTED (section H) |
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

### Validation at the lifecycle/bridge follow-up (historical)

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

| Selection | Historical result at `d7ec9c5...` |
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

## H. Privilege audit and quarantine assessment follow-up

### Audit scope and execution environment

The starting scoped tree was clean at `d7ec9c5...`; no dependency/manifest/
lockfile change is needed. The read-only audit found no high-confidence
exploitable vulnerability in the selected path. That is not certification of
kernel containment, privileged-runtime safety or production acceptance.
The host was observed as UID/GID 1000/1000; no explicit test delegated root was
supplied. This task forbids real cgroup mutation and real credential switching.
No shared cgroup was inspected as a substitute delegation, modified or used.

The following are **execution-environment** choices, not a renaming of launch
methods A/B/C above:

| Environment | Necessary authority and trust boundary | Decision |
|---|---|---|
| A: dedicated system service/supervisor | An independently authorized, narrowly exposed supervisor with switch/chown capabilities, approved image/input/resource admission, trusted runtime/signal setup and an administrator-delegated root. IPC authentication, installation/update/revocation and crash ownership would need approval. | Provisional architectural fit for the current root-supervisor/non-root-child model **only if such an independently authorized actor exists**. Availability/authorization BLOCKED; no service or APP elevation added. |
| B: privileged helper | A new distribution/pin/runtime trust root, constrained request protocol, setuid/file capabilities or other privileged admission, lifecycle and install/revocation policy. | NOT_SELECTED as a workaround; independently privileged helper is not approved or implemented. |
| C: user namespace | Approved UID/GID maps, setgroups policy, namespace/mount authority and separately established cgroup delegation/migration restrictions. Namespace-root capabilities do not imply authority over host-owned cgroups. Mapping helpers add another trust boundary. | UNVERIFIED; namespace/delegation compatibility is not established and no namespace/helper is introduced. |

This comparison does not authorize an independent actor. The APP is not made
privileged, and APP process/image authority remains OUT_OF_SCOPE.

### Credentials: source postconditions versus kernel evidence

The safe parent admission requires nonzero/non-sentinel target IDs, effective
UID 0, securebits 0 and effective CHOWN, SETGID, SETUID and SETPCAP.
These are checks in the caller's current namespace, not independent proof of
initial-user-namespace authority or administrative delegation. The caller also
needs actual filesystem/cgroup permission for preparation, birth placement,
kill and removal. A writable path or numeric IDs alone are not authorization.
The current UID-1000 process cannot satisfy this parent switch contract.

The actual child uses a fixed, allocation-free credential driver before
`execveat`. Its order is:

1. `PR_SET_NO_NEW_PRIVS=1`.
2. Drop bounding capabilities 0..63 (EINVAL ends the supported range).
3. Clear all ambient capabilities.
4. Raw `setgroups(0, NULL)`.
5. Raw `setresgid(target, target, target)`.
6. Raw `setresuid(target, target, target)`.
7. Capability-v3 `capset`: effective/permitted/inheritable all zero.
8. Re-read all six real/effective/saved IDs, supplementary-group count,
   effective/permitted/inheritable sets and NNP; also query filesystem IDs with
   `setfsuid(-1)` / `setfsgid(-1)` and require the dedicated IDs.

The filesystem-ID observations and the shared failure-short-circuit driver are
new here. Raw scalar syscalls and live stack `repr(C)` records remain inside
`native-launch/src/sys.rs`; no FFI/unsafe is introduced elsewhere. Every failed
step or mismatched postcondition reaches stage-4 error notification and `_exit`
before the untrusted image's exec call. A predicate mismatch is a refusal even
when errno is not useful as a syscall diagnosis. The target image is a sealed
mode-0500 ELF, not a script or setuid image. NNP also prevents exec-time
setuid/file-capability privilege gains. Bounding/ambient **removal return
values** are checked; they are not separately re-read by the final observation.

The driver unit tests inject failure at every step and check the same
short-circuit/order used by the real child. Separate predicate tests reject
each saved/filesystem-ID mismatch. These are **fake/state tests**, not real
setgroups/setresuid/capability or no-escape kernel experiments.

Inherited signal dispositions/mask are still not normalized or admitted by
this mechanism. A parent handler could run between clone and exec; ignored
SIGCHLD or SA_NOCLDWAIT can prevent the expected wait/reap contract. A future
privileged runtime must admit/implement and test its signal/clone environment.
No arbitrary multithreaded APP runtime is certified safe by the credential
postconditions, and no speculative signal rewrite is added here.

### Cgroup no-escape and cleanup audit

`clone3(CLONE_PIDFD | CLONE_INTO_CGROUP)` receives the anchored leaf FD,
placing the child at birth. There is no after-spawn migration race/fallback.
Only trusted child setup precedes credential removal; the image is not run
until that completes. CLOEXEC FD setup removes inherited control FDs at exec.
PIDFD identifies a task, not its descendants.

Root/ancestor `cgroup.procs`, root/leaf directories and opened controls are
checked root-owned and not group/world writable; the operation leaf is
exclusive mode 0700. A capability-free dedicated account cannot use those
checked controls to migrate, chmod the boundary or manage siblings under the
admitted, stable host policy. The privileged supervisor, not that child,
retains cleanup authority.

This is **conditional source reasoning**, not an unconditional no-escape
proof. The code does not establish dedicated-account allocation, all alternate
mount/migration-service policy, stable permissions after inspection, a trusted
administrator, or permission to operate the delegated subtree. Permission
checks precede later use and do not freeze host policy. Namespaces, privileged
services or helpers must not provide the child another migration authority.
Host/admin mutation and inherited signal behavior need explicit runtime
admission and real tests before any formal provider exists.

The supervisor still distinguishes stop/kill, direct reap, populated=0,
capture/error-pipe EOF, explicit FD closes and same-leaf removal/ENOENT.
Errors prevent normal lease release. Existing fake adapters exercise each
cleanup milestone, including kill/reap/empty/capture/removal failures. They do
not demonstrate real cgroup.kill, child descendants, escape resistance or
leaf removal on this kernel. All such actual cgroup integration is **BLOCKED,
NOT EXECUTED**, both by missing authority/delegation and this task's prohibition.

### Quarantine ownership and state contract

The audit found a concrete architectural limit, not a recoverable OS fact:
task/pidfd quarantine, cgroup/partial-disposal quarantine, native lease state,
capture observations and the Node channel are not one joined retained owner.
Direct reap retry never releases a slot. In some failure paths FDs have
already been consumed/closed and cannot be safely reconstructed from a path,
PID or caller JSON. Consequently no general unquarantine/release API is added.

| Condition | Actual state/owner | Allowed next step |
|---|---|---|
| Cleanup progressing | Existing native lifecycle; Node `CLEANUP_IN_PROGRESS` with its managed completion | Normal ordered cleanup may finish. Recovery requests reject without poisoning late normal completion. |
| Cleanup failed/unknown | Failure reason and occupied native lease/Node hold | Register/retain `QUARANTINED`, never refund or decrement occupied counters. |
| Quarantine retained | Native controller-bound operation record; branded Node budget/operation record | Inspect exact owner/ID and revision; no caller observer/path/socket replacement. |
| Recovery assessment running | `CHECKING` with a new revision/attempt | Ordered checks; cancel/deadline/failure invalidates that attempt. Stale/duplicate completion rejects. |
| Facts temporarily unavailable | `QUARANTINED` with reason | A bounded retry can use only remaining original work; time alone is not evidence. |
| Facts irrecoverably unjoined/mismatched | `ADMIN_REQUIRED` | Terminal in these APIs; retain slot. External administration is a requirement, not proof or a release action. |
| Every cleanup fact rechecked | `RECOVERABLE`, private fake checklist only | Classification only, no counter change; real adapter/reconciler NOT_IMPLEMENTED. |
| Cleanup confirmed | Existing normal native `CLEANUP_CONFIRMED` plus Node final event/channel close | Existing normal exactly-once settlement, not a recovery transition from quarantine. |

Native `Controller::inspect_quarantine` requires the original private Owner's
Arc identity and exact operation ID. `recheck_quarantine` also requires the
current revision, charges existing Cleanup work, and uses the existing cleanup
deadline/cancel flag. The mutex serializes assessment and epoch changes.
The private ordered checklist is: owner, child reaped, leaf identity, tree
empty, capture complete, FDs closed, bridge closed, lease terminal, leaf
removed. Failures are explicit; direct-child success cannot replace tree
empty. The only actual adapter confirms owner association and refuses the
unavailable joined record with `OWNED_RECORD_INCOMPLETE / ADMIN_REQUIRED`.
Every returned snapshot has `slot_released=false`. No recovery method can
decrement active/quarantine counters or re-use a settled lease.

Node `inspectNativeQuarantine(budget, operationId)` and
`recheckNativeQuarantine(budget, operationId, revision)` require the original
branded budget, exact retained ID and current revision. Records retain local
pending/scope state, bounded diagnostic native ID/phase, and closure observed
on the original Socket. No caller-supplied "closed" or "recovered" flag is
accepted. Normal settlement now also requires internally observed channel
close and the final native phase. The bridge still validates all event order,
IDs, outcome and bounded usage; diagnostic phase/JSON is not independent OS
cleanup proof or peer authentication.

Recheck spends one modeled work unit from the original scope's remaining
byte-work, even after scope close; it creates no replacement budget or OS
probe. Pending callbacks/open channel keep `LOCAL_CLEANUP_PENDING`; otherwise
the missing joined native record yields terminal `ADMIN_REQUIRED`. This
synchronous metadata-only transition cannot race an asynchronous callback
inside its checks. Stale revisions, unknown/foreign IDs, duplicate assessments
and extra force flags reject. Failed normal holds stay quarantined even if
later callbacks settle; non-quarantined late normal cleanup after cancel can
still finish through its existing owned completion.

The adjacent second-attach bug is fixed: after a normally completed hold has
deleted its record, another attachment in that same live scope reports
`NATIVE_RESOURCE_NATIVE_ALREADY_ATTACHED`, not an undefined-record TypeError.
It cannot affect another operation. No `force-release`, fresh socket,
administrator boolean, elapsed-time release or recovery registration factory
exists. Recovery state is process-local, not durable across restart/crash.

### Current validation and remaining recovery gate

The same isolated empty-HOME/offline-cache wrapper described above was used.
The target-filtered executable dependency identity comparison remains
55 unchanged; manifests and Cargo.lock are unchanged. Commands and results
for this follow-up (not old-checkout reruns) are:

```sh
cargo metadata --format-version 1 --filter-platform x86_64-unknown-linux-gnu --locked --offline
cargo check -p fusou-tlsn-native-launch -p fusou-tlsn-verifier --target x86_64-unknown-linux-gnu --lib --bins --examples --locked --offline --jobs 2
cargo build --locked --offline --package fusou-tlsn-native-launch --target x86_64-unknown-linux-gnu --example synthetic_probe --jobs 2
cargo test --locked --offline --package fusou-tlsn-native-launch --target x86_64-unknown-linux-gnu --lib --jobs 2 -- tests::
cargo test --locked --offline --package fusou-tlsn-verifier --target x86_64-unknown-linux-gnu --lib --bin verify_fusou_tlsn_evidence --jobs 2 -- offline_fd::tests strict_json::tests evidence_bundle::tests::acquisition:: tests::fd_mode_is_explicit_and_excludes_all_other_arguments tests::legacy_duplicate_flags_are_rejected tests::legacy_path_modes_preserve_all_arguments_and_optional_sparse_profile tests::unsupported_flags_and_fd_mixing_never_select_legacy_execution
FUSOU_NATIVE_BRIDGE_TEST_PEER="<compiled native lib test harness>" FUSOU_SYNTHETIC_PROBE="<compiled synthetic_probe>" node --test scripts/release-native-resources.test.mjs scripts/release-native-launch-bridge.test.mjs scripts/release-native-launch-peer.test.mjs scripts/release-consumer.test.mjs scripts/release-offline-fd.test.mjs scripts/release-checks.test.mjs
node --check scripts/release-native-resources.mjs
node --check scripts/release-native-resources.test.mjs
node --check scripts/release-native-launch-bridge.mjs
node --check scripts/release-native-launch-bridge.test.mjs
```

| Selection | Current result / actual scope |
|---|---|
| Native selected tests | 45 PASS: existing synthetic/preparation 25 + cgroup 3 + lifecycle 4 + bridge 3 + recovery 8 + credential driver/predicate 2 |
| Verifier parser/acquisition | 20 PASS: FD 10 + strict JSON 2 + acquisition 4 + CLI parser 4; no operational verifier/key-generating selection |
| Node resources / bridge / IPC peer | 23 + 24 + 9 PASS |
| Node consumer / FD / release-check | 18 + 53 + 46 PASS; Node total 173 |
| IPC peer scope | Seven fake cleanup cases and two actual direct-synthetic/cancel cases. Direct cases retain quarantine; no actual cgroup or dedicated-ID switch. |
| GNU metadata/check/probe build; JS syntax | PASS (exit 0); compilation/parse only, not formal native execution |
| Actual cgroup/credential switching/descendant/no-escape integration | BLOCKED, NOT EXECUTED |

During development, the first two new Node tests failed because their helper
treated scope completion with an outstanding native hold as success. The
fixtures now explicitly assert the existing `NATIVE_RESOURCE_PENDING_WORK`
refusal; no production assertion or pending-work rule was weakened.
The original existing 41 resource/bridge tests passed before these additions.
All fake checklist success remains classification only, with no release API.

True recovery needs a retained, operation-bound record joining the exact
task/pidfd/reap owner, anchored same-leaf identity/empty/removal observations,
capture/FD ownership and authenticated lifecycle-channel/lease terminal state,
plus a cancellation-safe, exactly-once cross-language reconciler. Acquiring
authority for that record, a durable crash policy and actual kernel tests are
NOT_IMPLEMENTED/UNVERIFIED; independent resource policy/shared issuer remains
NOT_IMPLEMENTED and unapproved. A human must approve the runtime/signal
profile, dedicated account, supervisor authority and host delegation before
those tests. External cleanup alone cannot turn these APIs into slot release.

Method B is retained: these changes add no launcher path or immutable namespace
trust root, and no privileged actor. They do not resolve musl/runtime closure,
independent bootstrap/provider registration, signer/trusted-builder approval,
real native input identity, real attestation/TLSN evidence or Production.
The trust states in section F remain unchanged.

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
