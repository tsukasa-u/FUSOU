# Offline FD input ABI v1

This is an input-integrity protocol, not a provider registration, signer
authorization, executable attestation, or Production acceptance protocol.
The formal CLI refuses FD execution until independent policy admission exists.
The current GNU build recipe is unchanged; musl static remains an unverified
runtime candidate. `gh` has a separate online runtime contract.

## Wire representation

All integers are unsigned little-endian. Every integer is at most 2^53 - 1
(and must fit the receiver's address space). Arithmetic is checked before
allocation or slicing. There are no optional wire fields or implicit limits.
The fixed header is 48 bytes:

| Offset | Width | Value |
|---|---|---|
| 0 | 8 | ASCII `FUSOUFD` followed by NUL |
| 8 | 2 | version = 1 |
| 10 | 2 | flags = 0 |
| 12 | 4 | header length = 48 |
| 16 | 4 | entry count |
| 20 | 4 | reserved = 0 |
| 24 | 8 | table length |
| 32 | 8 | total frame length |
| 40 | 8 | payload offset = 48 + table length |

The table immediately follows the header. Each record has a 64-byte prefix:

| Record offset | Width | Value |
|---|---|---|
| 0 | 2 | kind |
| 2 | 2 | flags = 0 |
| 4 | 4 | role UTF-8 byte length |
| 8 | 4 | logical-path UTF-8 byte length |
| 12 | 4 | reserved = 0 |
| 16 | 8 | absolute payload offset |
| 24 | 8 | payload byte length |
| 32 | 32 | SHA-256 of the exact payload bytes |

The prefix is followed by role bytes, then logical-path bytes, then zero
padding to the next 8-byte record boundary. Both strings are nonempty valid
UTF-8; roles match `[a-z][a-z0-9_]*`. Records are strictly ordered by numeric
kind, then role's ASCII bytes. Duplicate kind/role pairs are forbidden.
The table must contain exactly the declared records and padding, with no tail.

Payload alignment is **1 byte**. Payloads follow table order contiguously:
the first offset equals the header's payload offset, each subsequent offset
equals the preceding offset plus length, and the final end equals total length.
Gaps, overlaps, reordering, trailing bytes, and payload deduplication are not
allowed. An empty additional opaque artifact has a zero-length range; it does
not cause another entry to be omitted.

## Entry sets and logical paths

| Kind | Role | Logical path | Payload |
|---|---|---|---|
| 0 | `control` | `control.json` | control JSON below |
| 1 | `bundle` | `bundle.input` | original manifest bytes |
| 2 | each external role | `<role>.input` | original external input |
| 3 | each manifest artifact role | descriptor's `path` | original artifact |

The six external roles are `binding_authority_registry`, `origin_inventory`,
`session_authority_registry`, `target_approval`, `trust_anchor_der`, and
`trusted_notary_registry`. All six must occur exactly once.

Artifact entries must exactly match all manifest descriptors, including
additional descriptors. Undeclared roles are rejected. The required minimum is:

`presentation`, `result`, `result_registry`, `result_registry_envelope`,
`notary_registry`, `health`, `session`, `authenticated_user`, `device_identity`,
`device_authentication`, `possession_proof`, `consume_receipt`, `replay`,
`session_authority_registry`, `binding_authority_registry`, `capture_metadata`,
`semantic_verification`, `trust_root`, `subject`.

Thus the minimum entry count is 27: control + manifest + six external inputs +
19 artifacts. This does not imply 27 distinct contents. Each descriptor's
`artifact_sha256` (unpadded base64url SHA-256) and `byte_length` must match the
actual payload. The three external authority registries must equal their
bundled counterparts byte-for-byte; external DER must equal `trust_root`.

Paths are identifiers, never filesystem locations. Reject absolute paths,
backslashes, colons, NUL, empty segments, `.` and `..` segments, invalid Unicode,
duplicate destinations, and file/parent prefix collisions across **all** entries.
Do not percent-decode, normalize, case-fold, canonicalize, or reopen a path.
Manifest, Result, Presentation, registry and other original bytes are not
reserialized to build the frame.

## Control, identity, and authorization

Control is a JSON object with exactly these fields:

- `abi_version`: 1
- `scope`: `fusou-offline-fd-input-v1`
- `context`: exactly `repository`, `source_sha`, `workflow_sha`, `run_id`,
  `run_attempt`, using the existing release-check context
- `options`: the existing 12 scalar CLI options and optional
  `sparse-profile-sha256`, all nonempty strings, no unknown options
- `policy_sha256`: digest of the producer's snapshotted offline policy bytes
- `verifier_executable_sha256`
- `verifier_build_sha256`
- `runtime_profile_sha256`

The last four digests use unpadded base64url SHA-256. Build and runtime digests
are required explicit references, not claims that a build or profile was
approved or executed. The policy bytes are the existing canonical JSON encoding
of the owned policy. Control JSON need not be reserialized by a receiver:
its exact digest is independently compared.

Expected authority/target/profile values are data until compared with an
independently admitted policy. No `APPROVED` flag, self-declared digest, frame
inventory, seal, mock controller, or callback can supply that admission.
Registration must independently authorize the tuple of ABI version 1, Linux
x86-64, verifier image digest, build digest, runtime-profile digest, policy
digest and finite resource limits. A matching frame reference alone cannot
establish that a particular build/profile supports or is approved for this ABI.
The parser returns structural data only. Low-level bytes verification retains
the caller's obligation to supply independent expectations and is not formal
execution authorization. The formal `--fd-abi-v1` CLI rejects before stdin
access with `FD_POLICY_CONTEXT_NOT_REGISTERED`; no issuer is implemented here.
Path arguments cannot be combined with that switch. `--path-mode` explicitly
selects the legacy mode; omitting it preserves legacy invocation compatibility.

## Limits, JSON, and consumption binding

Every parser invocation requires explicit positive limits:
`max_frame_bytes`, `max_entries`, `max_entry_bytes`, `max_json_bytes`,
`max_json_nodes`, `max_json_depth`, `max_string_bytes`, `max_read_calls`. The latter
bounds every positional read attempt, including interruptions. The maximum JSON depth
is also bounded by the existing verifier ceiling of 64. These are inspection
limits, not independent policy approval. Formal admission must supply approved
limits from a shared issuer outside the frame.

Check size/count/arithmetic before table or payload allocation. Check per-entry
sizes and metadata-string sizes before allocation/slicing. JSON is checked for
size, UTF-8, lexical node count (containers, keys, scalar values), nesting and
raw string-token byte length before building a JSON value. Decoded strings are
also bounded in UTF-8 bytes. Reject duplicate decoded keys, including escaped
equivalents, malformed grammar/escapes, invalid Unicode, and trailing content.
Control, manifest, known JSON artifacts (all required roles except Presentation
and DER), and the five non-DER external inputs receive this check. Additional
opaque artifacts are byte-bound, not guessed to be JSON.
JSON limits apply to each document; the complete frame/entry bounds and the
Node operation's cumulative modeled work apply as well. Existing Node inspection
hard ceilings remain in force even if FD limits are larger. Those ceilings are
not newly approved resource-policy values.

The receiver recomputes every entry digest from consumed bytes. Its binding is:

- `abi_version`: 1
- `frame_sha256`: SHA-256 of all frame bytes
- `frame_byte_length`
- `control_sha256`: SHA-256 of the exact control payload
- `inventory_sha256`: SHA-256 of ASCII `FUSOU-FD-INVENTORY-V1` + NUL + table bytes
- `verifier_build_sha256` and `runtime_profile_sha256` from checked control

Digests in reports use unpadded base64url. Node compares this entire binding
with its private frame, not callback-owned buffers, and puts it in the same
receipt as stdout/stderr digests, argv, exit status, and operation context.
The receipt also archives the exact frame. Independent verification rebuilds
the expected frame from archived original inputs and the pinned policy.
The binding is not an executable measurement or a registered execution proof.

## Sealed FD and resources

The future producer creates one input memfd with `MFD_ALLOW_SEALING`,
`MFD_NOEXEC_SEAL` and `MFD_CLOEXEC`, writes the entire frame, verifies its length
and digests, then installs the required seals before handoff. Unsupported
features fail closed. Only the child input FD 0 is inherited across verifier
exec; its CLOEXEC bit must be cleared for that handoff, not on unrelated parent
descriptors. The verifier restores CLOEXEC on FD 0 and its owned duplicate.
These producer/launcher steps are requirements, not implemented runner code.

The Linux reader duplicates stdin through safe owned-FD APIs, checks a regular
non-executable sealed inode, requires WRITE/GROW/SHRINK/SEAL/EXEC seals, and uses
positional reads. `F_SEAL_FUTURE_WRITE` does not replace `F_SEAL_WRITE`.
The EXEC seal plus absent execute bits prevents later enablement of execution.
These properties do not authenticate who created the inode.

Check metadata size and bounded header/table before allocating the full frame.
Use exact offset reads, not the shared file cursor. Reject pipes, sockets,
unsupported sealing, missing seals, unsupported ABI, and short reads. No path
fallback exists. Owned duplicates close on drop; FD 0 remains process-owned.
No native runner or executable launcher is introduced.

Node reserves byte work before frame allocation/copies and charges hashing,
table construction, JSON inspection, capture and receipt work in the existing
operation scope. Callback frame/input copies have separate backing stores.
Timeout/cancellation retains scope ownership through callback settlement.
Modeled work is not peak RSS; child cgroups alone do not account for parent
copies or parent-created memfd pages. Aggregate/native limits and verified
disposal remain registered-provider prerequisites.

## Compatibility and status

The path acquisition wrapper remains available and delegates to a common
bytes verification core. Its mutable-path acquisition is not certified by this
ABI. All existing TLSN, Result, registry, authority, Target Approval and
transcript checks remain in that core.

Rust tests and shared Node-generated structural vectors do not prove Rust
compilation, native execution, actual evidence authentication, or deployment.
Executable identity and offline input integrity remain BLOCKED; runtime closure
and actual attestation verification remain UNVERIFIED. Provider registration is
NOT_IMPLEMENTED, authenticated/publication_authorized remain false, deployment
is NOT_CHECKED, and Production acceptance remains BLOCKED.
