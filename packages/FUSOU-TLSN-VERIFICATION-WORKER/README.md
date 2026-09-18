# FUSOU TLSNotary Verification Worker

This Worker is the authoritative authentication, binding, evidence-verification, signing, and result-delivery boundary for FUSOU TLSNotary alpha.15 `require_info` Presentations. In production, the `fusou-tlsn-trigger` Trigger.dev task performs the first verification pass, but the Worker independently re-fetches the stored Presentation and runs the profile-specific WASM verifier again before it signs or commits a Result. The Trigger callback is metadata-only; its HMAC authenticates the callback transport and does not authorize any Result fields.

The Worker issues a one-shot, authenticated Session/Binding context at `/attestation/session`. Session issuance requires the existing FUSOU device proof (`device_id`, the HMAC challenge nonce, and the Ed25519 signature over that nonce). Every Session also receives a fresh 32-byte TLSN device challenge. `/verify/tlsn` requires `presentation_base64`, `session_id`, `device_id`, `binding`, and `device_proof` (`challenge`, `sig`); the signature covers the current device, Session, binding, and challenge context. Rust/WASM verifies the Presentation and derives `verified_member_id` from authenticated response bytes. Client-provided member IDs are not accepted. Synthetic wire data is never treated as verified. `/verify/tlsn` emits the complete-disclosure Result profile. `/verify/tlsn/sparse` is a separate sparse profile endpoint, requires `TLSN_SPARSE_PROFILE_SHA256`, uses a separate Result signing domain, and carries the explicit sparse profile through Trigger mode.

In production, both attestation endpoints require `Authorization: Bearer <Supabase access token>`. The Worker resolves the token through Supabase `/auth/v1/user`, uses the returned `auth.users.id` as the canonical user subject, rejects anonymous users, and never stores the raw token. For session issuance it forwards that bearer token and the existing device proof to the configured FUSOU-WEB generic device-proof endpoint. During verification it forwards the bearer token and TLSN-specific proof context to the dedicated `/api/auth/anonymous-sync/v2/tlsn-device-proof` endpoint. FUSOU-WEB remains the device-auth authority: both paths use `user_devices` owner and `revoked_at`; the TLSN path verifies Ed25519 over the canonical proof message and atomically consumes its SHA-256 digest through the existing nonce table. The Worker stores only the backend-derived device ID and TLSN challenge in the Durable Object. The canonical user ID, device ID, and device challenge are included in the signed verifier-result bytes. A binding issued to one user/device cannot be looked up or consumed under another user/device context.

Test deployments may opt into a self-contained test-only path by setting `TLSN_TEST_AUTH_USERS`, `TLSN_TEST_DEVICE_ID`, and `TLSN_TEST_DEVICE_PUBLIC_KEY`. The bearer token then maps to a synthetic non-anonymous user in the Worker, and both device proofs are verified with the configured Ed25519 public key. This path is available only when `TLSN_ENVIRONMENT=test`; it does not contact Supabase or FUSOU-WEB and is never accepted by production configuration validation.

The Worker does not own a TLSN device registry, receive a Supabase service-role key, or receive a device private key. A client-supplied `device_id` is only a selector/proof input; the authoritative device identity comes from the FUSOU-WEB verification response and the Durable Object record. The generic device proof and TLSN proof are separate one-shot proofs and cannot be reused across Sessions or bindings.

Completion replay has a separate availability boundary. A Trigger callback is accepted only as metadata, after HMAC and schema validation. The Durable Object atomically moves a job from `processing` to `verifying` and assigns a short-lived verification attempt lease before the Worker reads R2 or invokes WASM. Only that lease owner may verify, sign, and commit a Result; concurrent duplicates receive `202` with `status: processing` and do not start another verifier. A lease-expired or failed owner returns the job to `processing`, allowing a later callback or retry to recover. A stale owner cannot commit a newer attempt. The Result bytes, exact SHA-256, consumed status, attempt identifiers, and binding metadata are committed together in one Durable Object transaction.

The authoritative Result is exact and non-transitive: it exists only when the Durable Object is `consumed`, the stored Result bytes are present, and their SHA-256 matches the committed digest. Status, direct replay, and callback replay read and validate those bytes from the Durable Object; they never perform a Result R2 GET. R2 is an optional asynchronous archive after a successful DO commit. An archive failure does not undo or delay authority, and an archive object is never evidence by itself. Result bytes are limited to slightly less than 2 MiB per Durable Object storage entry because the storage key consumes part of the platform's 2 MiB value budget; oversized Results fail closed before commit.

This bounds active duplicate amplification per binding to one Worker verification at a time, but it is not a global denial-of-service control. The Worker does not currently provide a global callback rate limiter or a per-principal quota; an authenticated caller or holder of the callback secret can still consume request, Durable Object, R2, Trigger, and platform quota. Lease expiry, Trigger retries, and configured binding TTL remain operational limits. These controls protect false-Result authority and concurrent work ownership; they do not make an untrusted callback endpoint unlimited-resource safe.

The availability and security boundaries are intentionally separate:

- False-result security: callback metadata, callback-supplied Result fields, stale attempts, and unbound R2 objects cannot promote a Result; promotion requires fresh WASM verification plus an atomic Durable Object Result commit.
- Per-binding availability: one active verification lease bounds duplicate callback work for one binding. A lease expiry permits one later owner to recover the binding.
- Lease and fencing: attempt IDs, job IDs, lease expiry, and exact attempt Result keys fence late owners. The binding expiry always wins over lease recovery.
- Global availability: there is no global callback limiter, principal quota, or cross-binding verifier budget. N independent bindings may therefore run up to N verifiers, subject to Trigger and platform limits.
- Persistence safety: Result promotion is a bytes-plus-hash transaction in the Durable Object. R2 archival is best effort and never participates in authority.

Sparse semantic parsing uses an authenticated forward-only range reader. Parser reads must advance through disclosed ranges in ascending order; a gap where the parser needs HTTP framing, the `svdata=` prefix, a required JSON key/value, or a required delimiter is rejected. A gap at a non-required opaque JSON value is the explicit exception: the cursor skips that entire value span and continues at the next disclosed structural token. The reader is not a random-access API. The sparse cryptographic claim is an explicit semantic projection, not a claim over the JSON document as a whole. It covers the HTTP framing, exact `svdata=` prefix, and the disclosed JSON tokens needed to establish `api_result == 1` and `api_data.api_basic.api_member_id`. Opaque string, number, object, and array interiors are outside that claim scope and are not cryptographically authenticated. The planner may scan the origin bytes to locate valid token boundaries, but that local scan does not authenticate undisclosed bytes. Request/response transcript sizes remain signed metadata, so changing a total size without changing the disclosed bytes invalidates the Result.

The boundary invariant is local and explicit: a valid sparse plan discloses the opaque field key, its colon, and the surrounding JSON structure; it omits only the selected opaque value span. The cursor may skip a gap only while parsing a non-required value, and the next disclosed byte must still satisfy the enclosing object's or array's separator rule. Adversarial gaps that hide a string quote, comma, nested delimiter, required key, or required value are covered by Rust and Worker tests and are blocked when the disclosed continuation cannot satisfy that rule. The verifier cannot inspect or independently authenticate bytes inside an undisclosed span, nor can it prove from the gap alone that those bytes form exactly one JSON value. Therefore the issuance path must use the verifier-owned planner and its body-free `{kind,start,length}` range report as the disclosure schedule; a hidden-value mutation passing is evidence that those bytes are intentionally outside claim scope, not evidence about their contents or semantics. The report itself never contains response body bytes.

The sparse threat model treats the Prover as malicious: it may omit arbitrary ranges, choose an insufficient disclosure schedule, and mutate bytes inside undisclosed spans. The verifier does not accept a Prover- or client-supplied range report as semantic authority; it derives the authenticated ranges from the verified TLSN Presentation and rejects any missing required byte before returning `PASS`. The planner and its report are generation and audit aids only. TLSN authentication proves the disclosed bytes, the sparse parser proves the narrow required semantic projection, and the signed Result binds the verifier's output and range metadata; these are separate evidence layers. A passing hidden-value mutation therefore remains outside the claim and must never be interpreted as authentication of hidden content or proof that a hidden gap is exactly one opaque JSON value.

The Prover-compromise and Trigger-compromise properties are separate. Against a malicious Prover, forged TLSN bytes, missing required semantic bytes, and malicious disclosure schedules remain blocked by the Presentation verifier and sparse parser. Against a compromised Trigger process or leaked callback HMAC, the Worker does not trust `prepared_result` data because completion callbacks contain no Result fields. It authenticates the callback, looks up the one-shot job, loads the exact private R2 Presentation, checks its SHA-256 against the binding's stored `presentation_id`, re-runs the configured complete or sparse verifier, re-checks binding/profile fields in the fresh verifier output, and only then derives and signs the Result. A valid callback HMAC alone therefore cannot mint a false Result. The Result signing key means "the Worker independently verified this Presentation under this policy," not merely "the Worker received a callback."

In Trigger mode, `/verify/tlsn` authenticates and atomically claims the binding, stores the raw Presentation in the private `TLSN_PRESENTATIONS` R2 bucket, records its SHA-256 as `presentation_id`, and returns `202` with a job ID. Trigger fetches that object through `/internal/tlsn/verification-input` using the shared HMAC callback secret, performs its work, and sends only job/binding/profile/status metadata to `/internal/tlsn/verification-complete`. The Worker independently fetches and verifies the stored object before signing and committing the Result to the Durable Object, then deletes the raw input object. A verified final response identifies the result-signing key with top-level `signer_key_id` alongside `signature_algorithm`; the signed result remains nested under `result`. `/verify/tlsn/retry` re-enqueues an accepted job without replaying the device proof; each new completion callback causes fresh verification from the stored Presentation.

## Local development

Requirements:

- Rust toolchain `1.95.0`
- Rust target `wasm32-unknown-unknown`
- `wasm-pack`
- A wasm-capable Clang compiler for ring's C backend

Build and run the fail-closed smoke tests:

```sh
rustup target add wasm32-unknown-unknown --toolchain 1.95.0
RUSTUP_TOOLCHAIN=1.95.0 pnpm test
```

The build script discovers `clang`, `clang-18`, or `clang-17`. Set `CC_wasm32_unknown_unknown` when Clang is installed outside `PATH`.

`pnpm test` runs Wrangler's local Worker runtime and checks device-proof session issuance plus verify-time TLSN possession through a synthetic FUSOU-WEB HTTP boundary, strict request validation, invalid/tampered Presentation rejection, user/device authority correlation, atomic single-use consumption including concurrent requests, expiry, identity and Notary fail-closed paths, and missing-configuration failure. FUSOU-WEB route tests cover the generic and TLSN device-auth primitives and reject revoked, invalid-signature, owner-mismatch, malformed-context, and replayed proofs. It does not contact the Game Server or Notary.

### Offline sparse measurements

These commands are offline and use synthetic alpha.15 data. They are reproducible parser and signing-path measurements, not production evidence:

```sh
node scripts/sparse-parser-memory-benchmark.mjs
TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES=4096,16384,65536,262144,524288,1048576 pnpm run generate:sparse-fixtures
TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES=4096,16384,65536,262144,524288,1048576 node --expose-gc scripts/sparse-crypto-benchmark.mjs
pnpm run benchmark:sparse-scope
```

The repository-local `require_info` fixture corpus can be measured separately:

```sh
pnpm run stats:require-info-fixtures
```

That command inspected 373 request/response pairs across 16 epochs without
printing tokens or response bodies. Response fixture bodies were 144,022 to
165,752 bytes (P50 150,080, P95 165,258, P99 165,751); JSON bytes after the
`svdata=` prefix were 144,015 to 165,745 bytes. These are metadata-plus-API-body
fixtures, not HTTP transcripts: status lines, headers, TLS framing, and a proven
wire transcript boundary are absent, so HTTP transcript size is
`NOT_ESTABLISHED`. The 1 MiB and 32 MiB cases below remain synthetic stress
measurements; 32 MiB is not justified by this corpus.

The real-body alpha.15 path is separate from the synthetic stress matrix:

```sh
pnpm run generate:sparse-real-fixtures
pnpm run benchmark:sparse-real
pnpm run benchmark:sparse-real-regression
```

The generator selects deterministic `S@api_get_member@require_info` fixtures at
P50/P95/P99/max body size and records the source epoch, filename, body size, and
SHA-256 in the local machine-readable manifest. Rust removes only the fixture
metadata delimiter and sends the remaining bytes unchanged. The local origin
reconstructs `HTTP/1.1 200 OK`, `Content-Length`, and `Connection: close`; the
request still uses the existing empty-body synthetic serializer because the
sparse semantic contract rejects non-empty `require_info` request bodies. The
corpus therefore remains `requestTranscriptStatus: NOT_ESTABLISHED`, and these
measurements are not production wire evidence.

The real-body measurements below preserve the old run as a BEFORE baseline.
`prover peak RSS` is captured during alpha.15 `prover.prove`; verification and
signing are the WASM verifier child process.

BEFORE (longest-string heuristic): the 12-byte gap between the response
transcript and disclosed/committed response was the largest JSON string interior
that the sparse parser could skip. This left nearly the entire real response in
the cryptographic claim.

| Case | Body | Reconstructed response | Committed response | Disclosed | Disclosure ratio | Sparse Presentation | Generation | `prover.prove` | Prover peak RSS | WASM verify | Sign |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P50 | 150,080 B | 150,142 B | 150,130 B | 150,130 B | 0.999920 | 151,904 B | 14,351.22 ms | 13,850.24 ms | 7,783,522,304 B | 21.06 ms | 24.92 ms |
| P95 | 165,258 B | 165,320 B | 165,308 B | 165,308 B | 0.999927 | 167,082 B | 16,246.35 ms | 15,741.47 ms | 8,059,215,872 B | 22.33 ms | 27.93 ms |
| P99 | 165,751 B | 165,813 B | 165,801 B | 165,801 B | 0.999928 | 167,575 B | 16,480.08 ms | 15,955.91 ms | 8,098,877,440 B | 22.99 ms | 26.91 ms |
| Max | 165,752 B | 165,814 B | 165,802 B | 165,802 B | 0.999928 | 167,575 B | 16,272.91 ms | 15,741.69 ms | 8,067,039,232 B | 22.48 ms | 26.70 ms |

AFTER (semantic range planner): synthetic and real paths use the same
verifier-owned planner. The response claim includes HTTP framing, the exact
`svdata=` prefix, and the disclosed JSON structure, keys, and values needed to
establish `api_result == 1`, the `api_data.api_basic` path, and the canonical
`api_member_id` value. It does not claim the JSON document as a whole. The
interiors of non-required opaque strings, numbers, objects, and arrays are
outside the claim scope; the sparse verifier skips those complete value spans
and does not cryptographically authenticate them. The planner's local syntax
scan is boundary discovery, not authentication of opaque bytes. The companion
range report exposes only kind, offset, and length for auditability and never
includes response body bytes. Ratios below are against the response body,
excluding the reconstructed HTTP headers; the range column is `count / largest
range`.

| Case | Body | Reconstructed response | Committed response | Committed body ratio | Disclosed response | Disclosed body ratio | Ranges | Sparse Presentation | Generation | `prover.prove` | Prover peak RSS | WASM verify | Sign |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P50 | 150,080 B | 150,142 B | 324 B | 0.001746 | 324 B | 0.001746 | 12 / 102 B | 3,477 B | 209.49 ms | 66.67 ms | 200,712,192 B | 10.81 ms | 3.01 ms |
| P95 | 165,258 B | 165,320 B | 324 B | 0.001585 | 324 B | 0.001585 | 12 / 102 B | 3,479 B | 211.53 ms | 71.89 ms | 201,392,128 B | 11.01 ms | 2.90 ms |
| P99 | 165,751 B | 165,813 B | 324 B | 0.001581 | 324 B | 0.001581 | 12 / 102 B | 3,477 B | 204.71 ms | 65.49 ms | 196,603,904 B | 10.96 ms | 2.80 ms |
| Max | 165,752 B | 165,814 B | 324 B | 0.001581 | 324 B | 0.001581 | 12 / 102 B | 3,477 B | 218.01 ms | 75.00 ms | 211,972,096 B | 10.47 ms | 3.04 ms |

All four AFTER cases passed sparse cryptographic and semantic verification. Each
child rejected 8/8 signed Result mutations and 2/2 disclosed-range mutations.
The real-data regression kept a valid hidden response mutation with the same
disclosed bytes and member ID, while disclosed-header, member-ID, and
Presentation mutations were all `BLOCKED`; the hidden mutation also preserved
the disclosed response digest. The new scope is substantially smaller, but
alpha.15 still used about 197-212 MiB peak RSS for these real-body proving
runs. The reconstructed HTTP status, headers, and TLS framing remain local test
inputs, not production wire evidence.

On Linux with Node `v22.21.1`, the parser benchmark produced the following measurements. `additional.rssBytes` is the child-process RSS increase during parsing.

| Transcript | Sparse disclosed | Sparse ratio | Sparse parse | Sparse RSS | Materialized parse | Materialized RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 134 B | 0.0001277924 | 1.168753 ms | 61,440 B | 1.044763 ms | 2,113,536 B |
| 4 MiB | 134 B | 0.0000319481 | 1.315778 ms | 57,344 B | 3.834926 ms | 8,409,088 B |
| 8 MiB | 134 B | 0.0000159740 | 0.987403 ms | 36,864 B | 7.996145 ms | 16,793,600 B |
| 16 MiB | 135 B | 0.0000080466 | 1.285620 ms | 53,248 B | 17.224014 ms | 33,570,816 B |
| 32 MiB | 135 B | 0.0000040233 | 1.042368 ms | 57,344 B | 42.031784 ms | 67,125,248 B |

The sparse crypto benchmark forces sparse proof generation in the child Cargo
process and records committed bytes separately from disclosed bytes. The
required six-case matrix was measured offline with the semantic range planner:

| Padding | Response transcript | Committed/disclosed response | Ranges (largest) | Body ratio | Sparse Presentation | Fixture generation | `prover.prove` | Prover peak RSS | WASM verify | Sign | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 4 KiB | 4,244 B | 146 / 146 B | 2 / 145 B | 0.020554 | 1,919 B | 202.21 ms | 46.20 ms | 154,406,912 B | 12.95 ms | 3.03 ms | PASS |
| 16 KiB | 16,533 B | 147 / 147 B | 2 / 146 B | 0.005221 | 1,921 B | 223.68 ms | 56.06 ms | 145,682,432 B | 12.45 ms | 2.74 ms | PASS |
| 64 KiB | 65,685 B | 147 / 147 B | 2 / 146 B | 0.001310 | 1,919 B | 185.59 ms | 45.01 ms | 162,619,392 B | 12.76 ms | 2.68 ms | PASS |
| 256 KiB | 262,294 B | 148 / 148 B | 2 / 147 B | 0.000328 | 1,921 B | 205.02 ms | 54.25 ms | 173,248,512 B | 10.99 ms | 2.49 ms | PASS |
| 512 KiB | 524,438 B | 148 / 148 B | 2 / 147 B | 0.000164 | 1,920 B | 203.15 ms | 10.05 ms | 167,067,648 B | 11.03 ms | 2.44 ms | PASS |
| 1 MiB | 1,048,727 B | 149 / 149 B | 2 / 148 B | 0.000082 | 1,922 B | 249.28 ms | 8.69 ms | 236,163,072 B | 10.79 ms | 2.43 ms | PASS |

The committed and disclosed response ranges are equal in sparse mode. Body
ratios exclude the reconstructed response headers; the request is committed and
disclosed separately. The sparse Result signature was independently verified
and rejected all 8/8 general mutations plus 2/2 disclosed-range mutations in
every child. The scope regression generated equal-length sparse responses with
different hidden interiors for string, number, object, and array values: both
Results remained valid for every kind, disclosed response bytes and their digest
stayed identical, and the verified member ID stayed `16189463`. Mutating
`response_transcript_size` was rejected by the signed Result contract. A 4 KiB
complete fixture passed complete verification with the same member ID;
full-Presentation/sparse-verifier and sparse-Presentation/full-verifier
cross-profile checks were both blocked.

The 4/8/16/32 MiB cases were not forced. Full Presentation memory remains `BLOCKED` because the sparse fixtures intentionally contain no full Presentation. These are synthetic/offline measurements, not production evidence.

### Worker E2E latency measurement

The full asynchronous Worker path can be measured with real-body sparse fixtures:

```sh
pnpm run benchmark:tlsn-e2e
```

The benchmark runs Wrangler `unstable_dev` with local R2 and Durable Object
storage, a local Trigger HTTP mock, and the actual Worker WASM verifier. The
mock returns the Trigger acceptance response before it performs input handoff,
first-pass WASM verification, and a metadata-only completion callback. The
benchmark then polls `/verify/tlsn/status` until the authoritative Result is
returned. It does not contact Trigger.dev, Cloudflare production services, the
Game Server, or the Notary.

The Direct path also has a test-only synchronous candidate. Set
`TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE=true` on a non-production test Worker
and run `node scripts/test.mjs --direct-only`. The candidate commits the
serialized Result bytes to the Durable Object, then relays those exact bytes
in the same `POST` response. The test compares them with authenticated status
recovery and checks that the first response performs no Result R2 GET. The
normal Direct path remains `202` plus status polling, and the candidate is ignored outside
`TLSN_ENVIRONMENT=test`.

To measure recovery when the initial synchronous `200` is lost at the client
boundary, enable the evidence-only benchmark mode with
`TLSN_REMOTE_DIRECT_RESPONSE_LOSS_RECOVERY=true`. The harness completes the
first request, discards that response as the simulated loss, then sends the
identical `POST /verify/tlsn/sparse` body again. It requires a `200`, exact
response byte and SHA-256 equality, `synchronous_replay_path=established`, one
direct invocation, one DO `commit_verified_result`, one DO `result_read`, one
optional `result_archive_put`, and zero Result R2 reads. The replay path never
invokes TLSN verification again and does not commit the binding again. Reports
contain only bounded sizes, hashes, timings, and diagnostics; they do not
contain access tokens, job IDs, trace IDs, proof signatures, or Result bodies.

Run the recovery evidence matrix against the dedicated non-production evidence
Worker only:

```sh
TLSN_REMOTE_EXPECTED_ENVIRONMENT=evidence \
TLSN_REMOTE_EXECUTION_MODE=direct \
TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE=true \
TLSN_REMOTE_DIRECT_RESPONSE_LOSS_RECOVERY=true \
TLSN_REMOTE_CONCURRENCY=1 TLSN_REMOTE_SAMPLE_COUNT=5 \
TLSN_REMOTE_BENCHMARK_REPORT_PATH=artifacts/tlsn-remote-recovery-c1.json \
pnpm run benchmark:tlsn-remote

TLSN_REMOTE_EXPECTED_ENVIRONMENT=evidence \
TLSN_REMOTE_EXECUTION_MODE=direct \
TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE=true \
TLSN_REMOTE_DIRECT_RESPONSE_LOSS_RECOVERY=true \
TLSN_REMOTE_CONCURRENCY=4 TLSN_REMOTE_SAMPLE_COUNT=20 \
TLSN_REMOTE_BENCHMARK_REPORT_PATH=artifacts/tlsn-remote-recovery-c4.json \
pnpm run benchmark:tlsn-remote

TLSN_REMOTE_EXPECTED_ENVIRONMENT=evidence \
TLSN_REMOTE_EXECUTION_MODE=direct \
TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE=true \
TLSN_REMOTE_DIRECT_RESPONSE_LOSS_RECOVERY=true \
TLSN_REMOTE_CONCURRENCY=8 TLSN_REMOTE_SAMPLE_COUNT=40 \
TLSN_REMOTE_BENCHMARK_REPORT_PATH=artifacts/tlsn-remote-recovery-c8.json \
pnpm run benchmark:tlsn-remote
```

The benchmark rejects this flag when the synchronous candidate is disabled,
and the synchronous candidate remains rejected for production.

The opt-in timing header is emitted only when
`TLSN_BENCHMARK_TIMINGS=true` and the Worker is a test deployment or an
explicitly opted-in production canary. Its legacy local stages are:

- `T0` job accepted after request, authentication, Binding, and device-proof validation and before the Presentation R2 put.
- `T1` Presentation persisted to R2; `T2` Trigger request completed.
- `T3` callback HMAC/schema accepted; `T4` verification lease acquired.
- `T5` Worker Presentation R2 read completed; `T6` Worker WASM verification completed.
- `T7` Result signing completed; `T8` Result committed to the Durable Object; `T9` the commit path completed.
- `T10` authenticated status polling returned the verified Result.

The machine-readable timing header separates `do_operations` from
`r2_operations`. Result authority uses `start_verification`,
`acquire_verification`, `commit_verified_result`, and `result_read` under
`do_operations`. The only Result R2 operation is the optional asynchronous
`result_archive_put`; Result R2 reads are expected to remain zero. The archive
write is scheduled with `waitUntil()` after the DO transaction and is not part
of the client-visible authority path.

`Accept 202` is the client request duration through the queued response.
`Poll total` is the client-visible duration from that `202` response until the
final status response. `Accept 202 + Poll total` is the complete client-observed
latency used for target classification. `Queue`, `Worker WASM`, and `Finalize`
are derived from the stage timestamps. `E2E` is the internal `T0..T10` span; the
machine-readable JSON also contains client-latency samples, R2 operation counts,
per-isolate verifier concurrency, and all raw timestamps. RSS is the benchmark
harness process; Worker isolate RSS is `NOT_ESTABLISHED` because Wrangler does
not expose that boundary.

The target is informational: approximately 2-3 seconds for complete client
latency, not a correctness gate. Values below were measured on Linux with
Node `v22.21.1`; table values are per-row medians from the P50/P95/P99/max
real-body cases. `C=2` and `C=4` use independent local Worker instances so
each generated Presentation can retain its matching synthetic trust anchor;
the request still traverses the actual Worker/R2/DO/WASM path. They measure
effective concurrent Worker instances, while the telemetry reports the
per-isolate verifier concurrency separately.

| Case | Body | Presentation | C | Accept 202 | Poll total | Queue | Worker WASM | Finalize | E2E | Peak harness RSS | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| P50 | 150,080 B | 3,477 B | 1 | 26 ms | 49 ms | 21 ms | 13 ms | 7 ms | 70 ms | 281.5 MB (+13.0 MB) | MEASURED WITHIN TARGET |
| P95 | 165,258 B | 3,478 B | 1 | 25 ms | 37 ms | 11 ms | 12 ms | 7 ms | 58 ms | 294.2 MB (+10.4 MB) | MEASURED WITHIN TARGET |
| P99 | 165,751 B | 3,476 B | 1 | 25 ms | 36 ms | 9 ms | 12 ms | 7 ms | 56 ms | 297.0 MB (+0.3 MB) | MEASURED WITHIN TARGET |
| Max | 165,752 B | 3,477 B | 1 | 24 ms | 35 ms | 9 ms | 11 ms | 7 ms | 54 ms | 299.7 MB (+0 MB) | MEASURED WITHIN TARGET |
| P50 | 150,080 B | 3,477 B | 2 | 35 ms | 41 ms | 13 ms | 12 ms | 9 ms | 71 ms | 308.3 MB (+0.1 MB) | MEASURED WITHIN TARGET |
| P95 | 165,258 B | 3,478 B | 2 | 36 ms | 42 ms | 13 ms | 12 ms | 9 ms | 73 ms | 314.1 MB (+0 MB) | MEASURED WITHIN TARGET |
| P99 | 165,751 B | 3,476 B | 2 | 31 ms | 40 ms | 11 ms | 12 ms | 9 ms | 67 ms | 320.1 MB (+0.1 MB) | MEASURED WITHIN TARGET |
| Max | 165,752 B | 3,477 B | 2 | 35 ms | 42 ms | 14 ms | 13 ms | 10 ms | 73 ms | 325.2 MB (+0 MB) | MEASURED WITHIN TARGET |
| P50 | 150,080 B | 3,477 B | 4 | 36 ms | 32 ms | 11 ms | 14 ms | 9 ms | 70 ms | 343.8 MB (+25.4 MB) | MEASURED WITHIN TARGET |
| P95 | 165,258 B | 3,478 B | 4 | 38 ms | 37 ms | 10 ms | 15 ms | 11 ms | 78 ms | 346.8 MB (+1.9 MB) | MEASURED WITHIN TARGET |
| P99 | 165,751 B | 3,476 B | 4 | 38 ms | 32 ms | 11 ms | 14 ms | 8 ms | 75 ms | 361.0 MB (+4 MB) | MEASURED WITHIN TARGET |
| Max | 165,752 B | 3,477 B | 4 | 37 ms | 48 ms | 16 ms | 15 ms | 9 ms | 80 ms | 360.8 MB (+2.3 MB) | MEASURED WITHIN TARGET |

These results establish the local path only. Trigger.dev scheduling latency,
Cloudflare production R2/DO latency, Worker isolate RSS, and production
concurrency behavior remain `NOT_ESTABLISHED`; a production-like deployment
measurement is still required before using this as an operational SLO.

Result authority has a hard storage boundary: the DO stores the exact final
response bytes under one storage key, with a maximum slightly below 2 MiB after
the `verification-result` key overhead is deducted. The full Result, including
the signed verifier payload and consume receipt, must fit this limit. R2
archive bytes may be larger only if the DO commit already fits; they are
operational copies and are never used by status or replay.

### Result storage scaling

Result byte growth can be measured without external access:

```sh
pnpm run benchmark:tlsn-result-storage
```

This benchmark uses a synthetic JSON Result and a local filesystem persistence
proxy. It reports `payload_bytes`, `signed_result_bytes`, archive-object bytes,
and `client_response_bytes`, plus Result construction/hash/write timings. Its
report is deliberately marked
`verification_semantics: NOT_TESTED`; it does not perform TLSN verification,
Durable Object commit/read, or remote R2 measurement. It must not be used to
infer that a Result larger than the DO limit is authoritative.

The current local three-repeat run measured these p50 values:

| Result object | Local write | Status read/hash/parse |
| ---: | ---: | ---: |
| 4 KiB | 0.09 ms | 0.22 ms |
| 64 KiB | 0.22 ms | 0.15 ms |
| 1 MiB | 0.66 ms | 2.04 ms |
| 4 MiB | 1.24 ms | 6.74 ms |
| 16 MiB | 3.59 ms | 34.04 ms |

These values are sizing evidence only. They indicate that large
`battle_data` Results need separate production R2 and status-response evidence;
they do not establish a production or canary latency gate.

### Production-like Worker E2E measurement

The production-like measurement has a separate entry point and must not be
confused with the local mock benchmark:

```sh
pnpm run benchmark:tlsn-remote
```

This command requires an already deployed test/staging Worker with real
Cloudflare R2 and Durable Object bindings, the real deployed Trigger.dev task,
and a random-binding configuration. A fixed canary binding is intentionally
rejected because each binding is one-shot and cannot provide a 20-sample
latency distribution. The Worker must have the opt-in public variable
`TLSN_BENCHMARK_TIMINGS=true`; normal production deployments do not enable this
telemetry.

In the default `supabase` mode, the benchmark reads all credentials and
device key material from the environment. It requires
`TLSN_REMOTE_BENCHMARK_WORKER_URL`, `TLSN_REMOTE_WEB_ORIGIN`,
`TLSN_REMOTE_SUPABASE_URL`, `TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY`,
`TLSN_REMOTE_ACCESS_TOKEN_A`, and `TLSN_REMOTE_DEVICE_ID_A`, plus either
`TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE` or
`TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL`. In `test` mode, only the
deployed Worker URL, the generated test token/user map, test device ID/public
key, and generated PKCS#8 private key are needed; Supabase and FUSOU-WEB are
skipped. It does not store these values, print them, or include them in the
JSON report.

The real P50/P95/P99/max fixture sources and manifest above are reused. For
each sample, the benchmark issues a fresh remote Session, generates an
ephemeral sparse Presentation from the existing source fixture using that
Session's binding, and excludes fixture generation from T0-T11. Defaults are
20 samples per case/concurrency and `C=1,2,4,8`; use
`TLSN_REMOTE_SAMPLE_COUNT`, `TLSN_REMOTE_CASES`, and
`TLSN_REMOTE_CONCURRENCY` to change the matrix. The report is written to
`artifacts/tlsn-remote-benchmark.json` or
`TLSN_REMOTE_BENCHMARK_REPORT_PATH`.

The client records T0 at `/verify/tlsn/sparse` request start, T1 when the 202
response is received, and T11 when verified status is received. The Worker
telemetry records T2 after the Trigger API accepts the task, T4 at callback
receipt, T5 at lease acquisition, T6 after the Worker R2 read, T7 after WASM,
T8 after signing, T9 after Result persistence, T10 after Durable Object
consume, and T11 at the final status response. The Trigger task records T3 at
the first task-code instruction and sends it as authenticated callback
metadata. Trigger's platform scheduler timestamp is not exposed by the current
SDK and remains `NOT_ESTABLISHED`; T2-T3 is therefore reported as a
cross-clock wall-time observation, without clock-skew correction.

In the current Worker ordering, Trigger task acceptance completes before the
client receives 202. The report records the Worker-side 202-send timestamp
separately rather than pretending that T2 occurs after client T1. Client
visible latency is always measured directly as `T11 - T0` by the benchmark
process.

The formal decision is based only on remote client-visible samples: every
requested sample must have all required timestamps, and each row's P95, P99,
and Max must be at most 3 seconds. The only outcomes are
`MEASURED WITHIN TARGET`, `EXCEEDS TARGET`, and `NOT ESTABLISHED`. Until this
command has been run against a real deployed Worker and Trigger.dev task, the
production-like result is `NOT ESTABLISHED`; the local 54-80 ms result is not
used as evidence for the remote target.

The remote report separates these boundaries:

| Boundary | Status before remote run |
| --- | --- |
| Client-visible Worker-to-status latency | `NOT_ESTABLISHED` |
| Trigger task start and queue observation | `NOT_ESTABLISHED` |
| Cloudflare R2/DO path | `NOT_ESTABLISHED` |
| Worker isolate RSS | `NOT_ESTABLISHED` |
| Production scheduler timestamp | `NOT_ESTABLISHED` |

Remote timing records may also contain optional Result serialization,
Result-R2 PUT request/response, and synchronous-response phases. Older Worker
timing records remain valid because these phases are not required for the
legacy `timing_complete` decision. Setting
`TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE=true` makes the remote harness expect
an explicit Direct `POST 200` response. A latency-only report generated before
recovery validation may mark `status_recovery_measurement` as `NOT_MEASURED`;
the recovery-validation run uses test-only response headers to recover the same
job through the authenticated status endpoint and compares response bytes,
Result hash, and Result byte count. This option is restricted to `test` or
dedicated non-production `evidence` environments and must not be used as
production/canary evidence.

This benchmark adds timing metadata only. It does not change
`VERIFICATION_LEASE_MS`, retry semantics, Durable Object transitions, timeout
policy, verification failure semantics, Result signing, attempt fencing, or
authoritative Result pointer/hash rules.

### Remote benchmark setup

The repository provides a self-contained test credential generator and a
dotenvx-backed encrypted environment for the remote measurement. Set the
Trigger API key once; deploy and benchmark commands load it automatically:

```sh
cp packages/FUSOU-TLSN-VERIFICATION-WORKER/.env.example \
	packages/FUSOU-TLSN-VERIFICATION-WORKER/.env
pnpm run tlsn:benchmark:remote:setup
read -rsp 'Trigger API key: ' TLSN_TRIGGER_SECRET_KEY; echo
pnpm exec dotenvx set TLSN_TRIGGER_SECRET_KEY "$TLSN_TRIGGER_SECRET_KEY" \
	-f packages/FUSOU-TLSN-VERIFICATION-WORKER/.env \
	-fk packages/.env.keys
unset TLSN_TRIGGER_SECRET_KEY
pnpm run tlsn:deploy:test:self-contained
pnpm exec dotenvx set TLSN_WORKER_INTERNAL_URL \
	https://your-test-worker.example \
	-f packages/FUSOU-TLSN-VERIFICATION-WORKER/.env \
	-fk packages/.env.keys
pnpm exec dotenvx set TLSN_REMOTE_BENCHMARK_WORKER_URL \
	https://your-test-worker.example \
	-f packages/FUSOU-TLSN-VERIFICATION-WORKER/.env \
	-fk packages/.env.keys
pnpm run tlsn:trigger:deploy:self-contained
pnpm run tlsn:benchmark:remote:self-contained:preflight
pnpm run tlsn:benchmark:remote:self-contained
```

`tlsn:deploy:test` now forwards the sparse profile hash and benchmark timing
flag. Leave `TLSN_TEST_BINDING_VALUE` empty so the test Worker uses random
bindings; the benchmark rejects fixed bindings. The Trigger values must point
to the deployed `tlsn-verification` task and its callback secret must match the
Worker. `TLSN_REMOTE_BENCHMARK_WORKER_URL` is the HTTPS URL of the deployed
test Worker, usually the `workers.dev` URL printed by Wrangler.

`tlsn:benchmark:remote:setup` generates a UUID v4 synthetic user, a UUID v4
device, an Ed25519 keypair, and a random bearer token. It writes the test-only
values into `.env` using `packages/.env.keys`; the temporary plaintext source is
removed after encryption.
Only `TLSN_WORKER_INTERNAL_URL` and `TLSN_REMOTE_BENCHMARK_WORKER_URL` remain
deployment-specific because a Worker may use a custom domain instead of its
`workers.dev` URL. The preflight
validates the generated values and fixture paths without contacting any
service. It does not access the Game Server or replay a Game Server request;
the benchmark only submits existing sparse fixture-derived Presentations to
the deployed verification Worker.

The root-level commands load the encrypted Worker `.env` through dotenvx, so
remote credentials need not be exported in the shell. The preflight output
contains only origins, the device ID, fixture labels, and matrix settings. It
does not print tokens, private keys, or response bodies.

### Sparse prover allocation investigation

Root cause:

- Before the fix, sparse mode committed the hidden response padding as well as the disclosed prefix and suffix. Alpha.15 `prove_plaintext` computes `commit union reveal`, allocates that union in the MPC VM, and builds the AES/ciphertext circuit over every allocated byte. The packed sparse `PartialTranscript` and the verifier's compatibility materialization were not the source of the 20 GiB peak.
- The sparse path now commits only the response ranges that it reveals. Hidden padding remains undisclosed and is not represented as an authenticated claim in the sparse profile.

Affected phase:

- `prover.prove`, specifically plaintext allocation and ciphertext/keystream circuit construction.

Complexity:

- At the TLSN layer, memory and circuit work are `O(C + R)`, where `C` is the committed plaintext range length and `R` is the revealed range length. The alpha.15 MPC VM has a large per-byte constant, so committing a 1 MiB hidden range is not a memory-bounded sparse operation.

Before:

- 1 MiB -> 21,728,813,056 B peak RSS (about 20.24 GiB) / 384.92 s `prover.prove`.

After:

- 1 MiB -> 236,163,072 B peak RSS (about 225 MiB) / 8.69 ms `prover.prove` in the current matrix run.

Sparse cryptographic verification: `PASS` for the local synthetic 1 MiB case.

Sparse semantic verification: `PASS` in the local synthetic scope.

Sparse Result signing: `PASS`; 8/8 general signed-Result mutations and 2/2 disclosed-range mutations rejected.

Sparse claim scope regression: `PASS`; equal-length hidden response mutation remained valid while disclosed bytes, range metadata, and signed transcript sizes remained protected.

Full Presentation memory: `BLOCKED`; sparse fixtures intentionally do not contain a full Presentation.

Production evidence: `BLOCKED`; no Game Server, Notary, Worker, or Trigger execution was used.

### Manual test deployment

The test Worker can be deployed from a developer machine without GitHub Actions. Copy `.env.example` to `.env`, fill the test values, and encrypt it with the repository key:

```sh
cp packages/FUSOU-TLSN-VERIFICATION-WORKER/.env.example packages/FUSOU-TLSN-VERIFICATION-WORKER/.env
pnpm run tlsn:env.encrypt
pnpm run tlsn:deploy:test
```

`tlsn:deploy:test` uses dotenvx to inject the environment, sends public values through Wrangler `--var`, and sends private values through a mode-600 temporary secrets file. The test deploy does not require a clean git worktree or GitHub Actions. Do not use this path for canary or production.

## Configuration

Configure these Worker values before deployment:

- `TLSN_BINDINGS` Durable Object binding for `TlsnBindingAuthorityDurableObject`
- `TLSN_PRESENTATIONS` private R2 bucket binding for pending and completed job objects
- `TLSN_BINDING_TTL_SECONDS` between `1` and `3600`
- `TLSN_SERVER_IDENTITY`
- `TLSN_PROFILE_SHA256`
- `TLSN_SPARSE_PROFILE_SHA256` when enabling `/verify/tlsn/sparse`; this is a separate trusted profile hash and is never used as a client-selected mode switch
- `TLSN_VERIFIER_KEY_ID`
- `TLSN_NOTARY_KEY_ID`
- `TLSN_NOTARY_REGISTRY`
- `TLSN_TRUST_ROOT_CERTIFICATE_DER` when the configured verification profile requires a custom trust root
- `TLSN_DEVICE_AUTH_URL` set to the FUSOU-WEB device-proof endpoint (`/api/auth/anonymous-sync/v2/device-proof` in the deployed API) for the test/non-production runtime
- `TLSN_DEVICE_POSSESSION_AUTH_URL` set to the dedicated FUSOU-WEB TLSN possession endpoint (`/api/auth/anonymous-sync/v2/tlsn-device-proof` in the deployed API) for the test/non-production runtime
- `TLSN_CANDIDATE_*` deployment values for the production candidate identity, FUSOU-WEB endpoints, Supabase URL/key, host allowlists, and both complete and sparse profile hashes
- `TLSN_PRODUCTION_NOTARY_REGISTRY` is the single public Notary registry input for the Production Worker, production evidence verifier, and APP public manifest. The selected `TLSN_CANDIDATE_NOTARY_KEY_ID` entry must be the same alpha.15 public verifying key passed to the APP.
- Production public configuration additionally requires `TLSN_PRODUCTION_NOTARY_ENDPOINT`, `TLSN_PRODUCTION_SESSION_AUTHORITY_ENDPOINT`, `TLSN_PRODUCTION_VERIFICATION_ENDPOINT`, and `TLSN_PRODUCTION_ORIGIN_PORT`. These values are validated offline and emitted as `tlsn-production-public-manifest.json` after a passing preflight.
- `TLSN_SECURITY_REGISTRY_SET_SHA256` for non-secret deployment and trust-registry identity
- `TLSN_TEST_AUTH_USERS` only in `TLSN_ENVIRONMENT=test`, as a JSON map of test bearer tokens to non-anonymous user IDs
- `TLSN_BENCHMARK_TIMINGS=true` only in `TLSN_ENVIRONMENT=test` or an explicit canary deployment; it enables the opt-in E2E timing header and is ignored in normal production deployments
- `TLSN_TEST_BINDING_VALUE` only in `TLSN_ENVIRONMENT=test`; the local E2E benchmark supplies one matching fixture binding to each independent Worker through the `X-FUSOU-TLSN-Test-Binding` session header
- `TLSN_TEST_VERIFICATION_LEASE_MS`, `TLSN_TEST_COMPLETION_DELAY_MS`, and `TLSN_TEST_POST_RESULT_DELAY_MS` are bounded test-only race controls; they are ignored outside `TLSN_ENVIRONMENT=test`. The corresponding `*_ONCE=true` values delay only the first completion in a local test Worker.
- Production Trigger execution additionally requires `TLSN_TRIGGER_API_URL`, `TLSN_TRIGGER_TASK_ID`, `TLSN_TRIGGER_SECRET_KEY`, and `TLSN_TRIGGER_CALLBACK_SECRET` on the Worker, plus the matching `TLSN_WORKER_INTERNAL_URL`, `TLSN_TRIGGER_CALLBACK_SECRET`, `TLSN_TRIGGER_SERVER_IDENTITY`, `TLSN_TRIGGER_PROFILE_SHA256`, `TLSN_TRIGGER_SPARSE_PROFILE_SHA256`, `TLSN_TRIGGER_VERIFIER_KEY_ID`, `TLSN_TRIGGER_NOTARY_KEY_ID`, `TLSN_TRIGGER_NOTARY_REGISTRY`, and `TLSN_TRIGGER_TRUST_ROOT_CERTIFICATE_DER` in the dotenvx-managed Trigger environment. These values are never returned by `/health` or embedded in task payloads. Trigger task payloads carry an explicit `profile` and `disclosure_mode`; sparse jobs use the sparse verifier and sparse result signer path.

- Deployment roles use separate result-signing inputs. Canary requires `TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI`, `TLSN_CANARY_RESULT_SIGNER_KEY_ID`, and `TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY`. Production requires the corresponding `TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI`, `TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID`, and `TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY`. The private key is used only by the matching Worker; the public SPKI and registry are published for independent verification.
- A result signing registry is a JSON object with `schema_version: 1`, `scope: "tlsn-result-signing-key-registry"`, and a non-empty `keys` array. Each entry has a unique `key_id`, Ed25519 `public_key_spki`, `status`, `not_before`, and nullable `not_after`. Valid statuses are `ACTIVE`, `VERIFY_ONLY`, `RETIRED`, and `REVOKED`. The configured signer must match an `ACTIVE` registry entry and be inside its validity window. Rotation adds the new `ACTIVE` key while retaining the previous key as `VERIFY_ONLY`; retired or revoked keys cannot sign new results.
- Remote validation uses an independent `TLSN_REMOTE_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8`. Production receives only `TLSN_ATTESTATION_SIGNER_KEY_ID` and `TLSN_ATTESTATION_SIGNER_PUBLIC_KEY_SPKI` as its trust anchor and never receives the attestation private key. `TLSN_MAX_ATTESTATION_AGE_SECONDS` defaults to `900` and is bounded to `1..86400`.
- Device URLs must use HTTPS, match an allowlisted DNS hostname, contain no credentials/query/fragment/alternate port, and use the exact deployed FUSOU-WEB API paths. `TLSN_CANDIDATE_SUPABASE_URL` must satisfy the same HTTPS and clean-origin policy and match `TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS`. Production does not accept `TLSN_TEST_BINDING_VALUE`. The test environment may use `TLSN_TEST_BINDING_VALUE` only to seed the synthetic fixture binding; it is not a Prover authority.

`TLSN_SUPABASE_PUBLISHABLE_KEY` is a publishable client key, not a service-role key. Do not configure a service-role key in this Worker. Missing production auth configuration fails closed with `503 auth_unconfigured`; missing, unknown, malformed, or anonymous credentials return `401 unauthorized`.

## Production Trust Contract

The following values are the Production source of truth. The raw registry JSON is kept byte-for-byte identical wherever it is captured or compared; its hash is an identity field, not a replacement for the registry contents. Every Notary registry value is canonical base64url for the pinned alpha.15 bincode `tlsn_attestation::signing::VerifyingKey` using the FUSOU Notary `K256` algorithm and compressed SEC1 public key.

| Authority | Public source | Private source | Consumers |
| --- | --- | --- | --- |
| TLSN alpha.15 Notary | `TLSN_PRODUCTION_NOTARY_REGISTRY` plus selected `TLSN_CANDIDATE_NOTARY_KEY_ID` | Notary deployment only | Worker, offline evidence verifier, public manifest, APP selected verifying key |
| Session Authority | `TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID`, `TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY` | `TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8` | Worker issuance, offline evidence verifier, public manifest |
| Binding Authority | `TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID`, `TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY` | `TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8` | Worker consume receipts, offline evidence verifier; never APP |
| Result signer | `TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID`, `TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY` | `TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8` | Worker result signing, offline evidence verifier, public manifest, APP result verification |

The Production workflow connects those public values to preflight and Worker `--var` inputs, and connects the Session/Binding private keys and the existing Result signing private key to the temporary secrets file. No private authority material is written to the public manifest or sent to the APP.

The public manifest schema is:

```json
{
	"schema_version": 1,
	"scope": "tlsn-production-public-config",
	"notary": {
		"endpoint": "host:port",
		"key_id": "...",
		"verifying_key": "...",
		"registry_entry": { "key_id": "...", "verifying_key": "..." },
		"registry_sha256": "..."
	},
	"session_authority": {
		"endpoint": "https://.../attestation/session",
		"key_id": "...",
		"public_key_spki": "...",
		"key_registry_sha256": "..."
	},
	"result_signing": {
		"key_id": "...",
		"public_key_spki": "...",
		"key_registry": {
			"schema_version": 1,
			"scope": "tlsn-result-signing-key-registry",
			"keys": []
		},
		"key_registry_sha256": "..."
	},
	"verification_endpoint": "https://.../verify/tlsn",
	"origin": {
		"server_identity": "...",
		"trust_roots": ["..."],
		"port": 443
	}
}
```

`pnpm run render:app-config` maps this manifest to APP public TLSN settings, including the Result signer SPKI, signer key ID, and complete public registry, and receives the local artifact path as a separate argument. APP constructs its own fail-closed Result signature verifier from those public values. APP receives no Binding Authority registry, private key, bearer token, service credential, device key, or Cloudflare credential.

For rotation, publish the new Notary registry and selected key together, then regenerate the public manifest and APP config. For Session or Binding Authority rotation, publish the new public SPKI, key ID, registry, and matching private secret as one deployment unit. The new key must be `ACTIVE`; the previous Session/Binding key may remain `VERIFY_ONLY` for historical receipt verification, but must not issue new receipts. Validate the old/new registry hashes and public-key identities offline before deployment, and retain the previous complete configuration for rollback.

## Deployment preflight

Run the preflight in the same CI environment that supplies the production Worker variables:

```sh
pnpm run preflight:production
```

`scripts/production-inputs.json` is the explicit production input contract and the deploy wrapper's allowlist. The preflight checks required production variables, clean HTTPS URLs and exact FUSOU-WEB paths, DNS allowlists, profile/security digests, Notary registry membership, result-key publication, and the absence of test fixtures, service-role keys, and device-private-key variables. It writes only non-secret failure metadata to `artifacts/tlsn-deployment-preflight.json` or `TLSN_PREFLIGHT_REPORT_PATH`, plus `artifacts/tlsn-production-provenance.json` or `TLSN_PROVENANCE_REPORT_PATH`; it never prints configuration values.

The passing Production preflight also writes the public-only `tlsn-production-public-manifest.json`. It contains the Notary endpoint, selected Notary key ID and registry entry, Session Authority endpoint/key ID/public SPKI and registry hash, Result signer key ID/public SPKI/registry and registry hash, Verification Worker endpoint, server identity, trust-root DER bytes, and origin port. It contains no private key, bearer token, service credential, device key, or Cloudflare credential. Use `pnpm run render:app-config -- --manifest <manifest> --output <configs.toml> --artifact-output-path <local-directory>` to create an APP config; the artifact path is intentionally supplied separately because it is APP-local.

Use `pnpm run deploy:production` for the guarded deploy entry point. It runs the preflight, captures the previous production identity, runs remote validation against the canary, verifies the fresh report, deploys only after that gate passes, and performs post-deploy identity and unauthenticated smoke checks. It injects non-secret manifest inputs through Wrangler `--var` and uploads the signing key and trust root through a temporary mode-600 secrets file. Wrangler authentication remains CLI-only; a failed prerequisite cannot deploy.

The complete offline contract check is `pnpm run test:production-roundtrip`. It generates synthetic authority keys and an X.509 root, uses a pinned alpha.15 K256 key, runs Production preflight, validates the public manifest, renders the APP TLSN fragment, parses it through the APP config loader, and requires APP preflight `ready=true`. It does not contact a Game Server, Notary, Worker, Supabase, or any other remote service.

## Remote validation

`scripts/remote-validation.mjs` exercises deployed HTTP boundaries and verifies the returned Ed25519 result independently in Node.js. It writes `artifacts/tlsn-remote-validation.json` with the current workflow run, commit, validation ID, and validation timestamps. Declared `production_evidence` and `p0_05` blocks are report status only; any other blocked or failed check prevents the gate from passing and returns a non-zero exit code. `scripts/verify-remote-gate.mjs` recomputes the Canary provenance and remote report hashes and writes an immutable `tlsn-remote-validation-attestation.json` only after the report passes.

The attestation is schema version 2 with scope `tlsn-remote-validation-attestation`. Its signature covers a fixed canonical JSON payload containing the workflow context, canary provenance hash, remote report hash, security identity hash, validation window, validation ID, and creation time. It carries `signature_algorithm: "Ed25519"`, `attestation_signer_key_id`, and `signature_base64url`. Production verifies the signature against the configured attestation public SPKI, requires the expected workflow context and canary identity, recomputes both artifact hashes, and rejects future or stale validation results.

The verify Worker used by the synthetic fixture may have one fixed `TLSN_TEST_BINDING_VALUE`. Session sampling must use a separate Worker URL without that variable; the harness requires `binding_mode: random` and at least 100 unique session IDs, binding values, and device challenges, so fixed-binding reuse cannot masquerade as a benchmark. The cold/warm WASM metric is explicitly labeled as binding-mismatch measurement and is not valid-verification performance. Concurrent replay uses a separate fixed-binding Worker and requires exactly one success. Payload/resource and per-field signed-result mutation matrices are included. Revocation and expiry checks likewise require separate Worker URLs and disposable test devices; when both run, expiry uses unrevoked User B. Revocation is opt-in and permanently revokes the configured device.

Required harness inputs are supplied through CI secrets or a local secret manager, never committed:

- `TLSN_REMOTE_WORKER_URL`, `TLSN_REMOTE_SESSION_BENCHMARK_URL`, `TLSN_REMOTE_WEB_ORIGIN`, and `TLSN_REMOTE_SUPABASE_URL`
- `TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY`, `TLSN_REMOTE_ACCESS_TOKEN_A`, `TLSN_REMOTE_DEVICE_ID_A`, and either `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL` or `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE`
- `TLSN_REMOTE_FIXTURE_JSON`, `TLSN_REMOTE_RESULT_PUBLIC_KEY_SPKI`, and `TLSN_REMOTE_EXPECTED_MEMBER_ID` (the last value may instead be `expected_member_id` in the fixture)

Set `TLSN_REMOTE_ACCESS_TOKEN_B`, `TLSN_REMOTE_DEVICE_ID_B`, and the corresponding device key to enable cross-user attacks. Set `TLSN_REMOTE_FIXTURE_B_JSON` to a fixture with a different binding value for context swapping. Set `TLSN_REMOTE_REVOCATION_WORKER_URL` and `TLSN_REMOTE_RUN_REVOCATION=true` for verify-time revocation; set `TLSN_REMOTE_EXPIRY_WORKER_URL` and `TLSN_REMOTE_RUN_EXPIRY=true` for expiry. A sanitized log export can be scanned with `TLSN_REMOTE_LOG_EXPORT`.

Run it with:

```sh
pnpm run validate:remote
```

Remote validation currently exercises `/verify/tlsn` and verifies the complete Result profile only. The sparse endpoint still requires a remote sparse capture and production fixture; offline contract tests cover its local parser and payload boundaries.

Status: authenticated user ownership `PASS`; authenticated device ownership `PASS`; current device possession proof `PASS, local synthetic scope`; TLSN/device cryptographic binding `PASS, local synthetic scope`; replay/expiry `PASS`; production evidence `BLOCKED`; `P0-05` `BLOCKED`. The remote report always records `production_evidence` and `p0_05` as `BLOCKED`, even when every synthetic check passes. The production trust contract is not complete until the deployed FUSOU-WEB endpoints, production device registry/revocation behavior, production trust material, a Notary key registry, replay/session authority, result-key publication and rotation, and performance evidence are exercised remotely. The test Worker and synthetic evidence do not satisfy that contract.

`production_evidence` is governed by the `tlsn-production-evidence` contract. Its status remains `BLOCKED` until independently captured evidence verifies a real production Game Server connection, TLSN Notary interaction, FUSOU-WEB authentication and device possession, replay and binding authorities, verifier trust root, result signer, public-key publication, and the complete production capture. Passing synthetic checks, signing a remote report, or verifying the attestation does not satisfy these requirements and cannot unlock `production_evidence` or `P0-05`.
The Production job independently verifies the attestation, its artifact hashes, the current workflow context, the Canary/Production security identity match, and the previous-known-good identity change report before deployment. No bypass variable is used for declared blocked evidence, and both `production_evidence` and `p0_05` remain `BLOCKED`.

## Production Evidence Capture

`pnpm run capture:production-evidence` is a standalone evidence verifier. The preferred input is `TLSN_PRODUCTION_EVIDENCE_BUNDLE_PATH`, a directory emitted by FUSOU-APP containing `presentation.bin`, `metadata.json`, the APP-issued `session.json`, `device-authentication.json`, `possession-proof.json`, `worker-verification.json`, `result.json`, and `consume-receipt.json`. Bundle mode consumes the already-used Session and signed Result, so it does not issue a second Session or submit the Presentation for a second first-use verification, and it does not require a device private key. For legacy standalone input, set `TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PATH` to raw Presentation bytes and `TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PROVENANCE_JSON` to its sidecar; that mode requires a registered device private key and performs the first Worker verification itself. Both modes require a real production Worker, FUSOU-WEB and Supabase origins, a non-anonymous access token, the production result signing registry, and `TLSN_PRODUCTION_NOTARY_REGISTRY`. The sidecar must identify `fusou-proxy-production-tlsn`, declare `capture_provenance: "production"`, set `synthetic`, `test`, `canary`, and `local` to `false`, record the exact `POST /kcsapi/api_get_member/require_info HTTP/1.1` profile, include the Presentation SHA-256, and include a separate `proxy_provenance` object. The sidecar is capture metadata, not TLSN authority evidence: without `TLSN_PRODUCTION_PROXY_PROVENANCE_PIN_JSON`, its proxy cryptographic predicate remains `UNVERIFIED`; a self-declared signature cannot become `VERIFIED`. A pin must contain the external Ed25519 public key, signer key ID, proxy identity, deployment ID, and binary identity. Fixture bytes, candidate registries, member IDs, request/response declarations, and metadata-only provenance cannot satisfy this input contract. The alpha.15 verifier derives the server identity, transcript digests/ranges, HTTP profile, and member ID directly from the cryptographically verified Presentation. The authenticated request binding must match the APP-issued Session binding and encoded session ID. The harness independently verifies the signed Result and verifies one-shot replay rejection without making any Game Server request.

The harness never promotes the gate: the manifest governance status, `production_evidence`, `p0_05`, and independent governance status remain `BLOCKED`, including when capture and semantic verification pass. `pnpm run verify:production-evidence` performs offline verification of the manifest signature, trusted workflow/deployment identities, artifact hashes, captured Notary and result registries, captured trust root, alpha.15 Presentation cryptography, strict HTTP semantics, authenticated member derivation, direct Presentation-to-Session freshness, session/device/subject binding, Result-to-Presentation correlation, proxy provenance status, and replay evidence. Synthetic declarations, metadata-only manifests, altered artifacts, stale manifests, wrong signer keys, unrelated Result/Presentation pairings, old Presentations paired with fresh Sessions, and context substitutions are rejected or remain blocked.

The evidence signer uses `TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID`, `TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8`. These are separate from both the remote attestation signer and the Worker Result signer; the private key is used only by the capture job and is never sent to the Worker. Live capture credentials and device keys must be supplied through the CI secret manager and are not committed.
