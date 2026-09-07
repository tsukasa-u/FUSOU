# P0-05 FUSOU Session and TLSNotary Proof Binding Comparison

Date: `2026-09-06`; header-name follow-up: `2026-09-07`

Requested/current baseline: `9d343da4abc1865e3d1fb8c9b2e20943006da9d1`
Audited repository HEAD before this follow-up: `9d343da4abc1865e3d1fb8c9b2e20943006da9d1`
Selected TLSNotary revision: `refs/tags/v0.1.0-alpha.15` at `47aee45b53e06648c1b2ad3689b367b8c923fdec`

Decision: `C: CURRENTLY BOTH BLOCKED FOR PRODUCTION`

This is an experimental comparison. It does not change the FUSOU production
route, production schema, production database, production configuration, normal
retry/fallback behavior, or normal FUSOU-APP gameplay path. It does not convert
the P0-04 natural capture into TLSNotary evidence.

## TARGET

The unchanged P0-05 claim is:

```text
FUSOU-MITM
  -> TLSNotary alpha.15 Prover-owned origin TLS
  -> Game Server
```

The proof must authenticate the exact origin request sent by the Prover-owned
TLS connection and the corresponding Game Server response. Browser, WebView,
OS, and client-intent provenance are outside this claim.

The binding question is narrower:

```text
FUSOU Session <-> TLSNotary Presentation/proof
```

A secure design must prevent a proof created for Session A from being accepted
for Session B. An HTTP field name is not itself a cryptographic property. The
security property is an authority-issued value that is present in the
TLSNotary-authenticated request, or an independently verified cryptographic
relationship that alpha.15 actually authenticates.

## CURRENT PRODUCTION

Production remains unchanged:

- FUSOU-WEB production route: unchanged;
- FUSOU-WEB production schema and tests: unchanged;
- FUSOU-PROXY normal gameplay route: unchanged;
- existing Hyper/rustls origin transport: unchanged;
- FUSOU-APP normal gameplay path: unchanged;
- production database, migrations, configuration, retry, and fallback: unchanged.

The existing natural capture is separate evidence:

```text
ordinary FUSOU-APP gameplay
  -> existing Hyper/rustls origin transport
  -> passive exact-wire capture
```

It is not a TLSNotary Presentation and cannot satisfy P0-05 authenticated
disclosure.

## ALPHA.15 PROTOCOL FACTS

The pinned adapter calls:

```rust
presentation.verify(&CryptoProvider::default())
```

and accepts only the verified output's authenticated server identity,
Attestation ID, complete sent/received transcript, authenticated ranges, and
transcript bytes. The adapter then applies the FUSOU HTTP and JSON parser.

The observed alpha.15 API does not provide a FUSOU Session ID, FUSOU Proof
Attempt ID, FUSOU Challenge nonce, or an automatic binding between those values
and the Presentation. `ConnectionInfo.time` is TLS connection-start metadata,
not Notary issuance time or FUSOU Session authority. The Attestation ID is an
opaque alpha.15 identifier; it is not a pre-issued FUSOU Session binding.

Therefore:

- alpha.15 authenticates disclosed TLS transcript bytes and the attested server
  identity;
- alpha.15 does not automatically authenticate arbitrary local metadata;
- a local database row, proof-attempt ID, or challenge is not authenticated by
  merely being stored next to a Presentation;
- a FUSOU Session binding must either be carried inside authenticated transcript
  bytes or be established by a separate cryptographic authority that is itself
  verifiably linked to the proof.

## EXPERIMENTAL CANDIDATE A

Candidate A is:

```text
server-issued single-use opaque binding
  -> X-Attestation-Binding in the origin request
  -> alpha.15 authenticated sent transcript
  -> FUSOU verifier checks the issued Session/nonce
```

### Meaning of the header

`X-Attestation-Binding` is not a Game Server authentication field and the
literal `FUSOU` prefix is not a security property. The header is an explicit
carrier selected by the FUSOU experimental profile so the strict parser can
locate one value in the authenticated request.

The field name has no cryptographic significance. A different generic field
name could carry the same opaque value if the profile and parser changed
together. The generic name reduces project-specific naming only; it does not
make the request indistinguishable from ordinary game traffic. The Game Server
may still observe an unknown/custom header, and accept/ignore/strip/normalize/
reject behavior remains unverified.

The security properties are:

- the value is issued by a trusted FUSOU Session/Challenge authority;
- the value contains the expected UUIDv4 Session and 32-byte nonce under the
  current experimental framing;
- the exact request bytes are sent by the Prover-owned TLS connection;
- the full sent transcript is disclosed and verified;
- the verifier compares the authenticated value with the expected Session and
  nonce;
- the value is single-use and rejected after consumption.

A different field name could carry the same opaque value if the profile and
parser were changed together. Removing the header without adding another
cryptographically linked carrier removes the current binding evidence; changing
the name alone does not improve security.

### Synthetic evidence

The existing Prover-owned synthetic origin harness sends the binding before the
origin serialization, captures the exact request and response, creates a test
alpha.15 Presentation, verifies the Presentation, and derives the response
member ID through the strict parser. The new experimental correlation authority
adds these checks:

- an unissued binding is rejected;
- a proof carrying Session A's binding cannot be consumed for Session B;
- a valid issued binding is consumed once only;
- a later reuse is rejected.

The focused comparison suite passed:

```text
6 passed; 0 failed
```

This is `SYNTHETIC` evidence. It is not a Real Notary, Real Game Server,
production Dedicated Verifier, or production signer result.

### Protocol and compatibility limits

The binding header is an HTTP modification visible to the Game Server and any
intermediary. The current strict parser permits unknown non-framing headers and
preserves them in the authenticated digest. That establishes local parser
semantics, not remote compatibility.

The following are `NOT VERIFIED` for the real Game Server path:

- unknown-header acceptance by the Game Server application;
- rejection of unknown headers;
- header stripping or normalization by a proxy, CDN, or WAF;
- header ordering effects at any intermediary;
- request-signature or cache behavior;
- application behavior when the header is present;
- whether an upstream intermediary preserves the exact bytes observed by the
  Prover.

TLSNotary can authenticate the bytes sent by its Prover-owned TLS connection. It
cannot make an intermediary preserve a header or make the Game Server
application interpret an unknown field as FUSOU authority.

## EXPERIMENTAL CANDIDATE B

Candidate B removes the custom HTTP header:

```text
FUSOU Session
  -> local proof-attempt or challenge metadata
  -> alpha.15 authenticated origin exchange without a FUSOU header
  -> FUSOU-side correlation
```

### B1: Server-side proof-attempt correlation

A database row containing `(Session A, ProofAttempt A)` and a later
Presentation does not prove that the Presentation was created under Session A.
Unless an authenticated field in the Presentation or transcript commits to the
row, an attacker can submit Presentation P from Session A with correlation
metadata from Session B.

The experimental module represents this as an intentionally unsafe
`naive_db_join_for_demonstration`. The test pairs proof A with Session B and
shows that a database join alone can produce that inconsistent record. The
secure evaluator rejects the same input with
`HeaderlessSessionBindingUnavailable`.

### B2: Challenge or nonce correlation

A server-issued challenge is useful only if the verifier can prove that the
challenge belongs to the authenticated proof. A challenge kept only in local
metadata is not automatically included in alpha.15's authenticated output.
The test suite therefore rejects a local `(Session, Attempt, Challenge)` context
when no corresponding authenticated transcript field exists.

A header-less design could become secure only by adding another independently
verified cryptographic link, for example an authority-signed envelope whose
covered digest is verified against a proof-bound value. If the challenge is
placed in the HTTP path, query, body, or another transcript byte, that is still
an HTTP/request modification even if it is not a header. No such alpha.15 API
link is established in this repository.

### B3: Existing Game Server authentication

Cookies, Game Server session tokens, and local game state may identify a Game
Server account or session to the Game Server. They do not, by possession alone,
prove FUSOU user/device ownership or bind that account to a FUSOU Session. A
copied cookie, a shared account, a stale token, or an attacker-controlled local
state can cause the Game Server context and FUSOU Session context to diverge.
No repository or alpha.15 evidence establishes the required identity mapping.
This route is therefore `NOT ESTABLISHED`.

### Synthetic B evidence

The new tests use the pinned alpha.15 upstream Presentation fixture to confirm
that a verified alpha.15 output can expose Attestation ID and transcript
digests while exposing no FUSOU Session, Proof Attempt, Challenge, or parsed
member ID field. The fixture is an upstream `REAL_ALPHA15_VERIFICATION` fixture,
not FUSOU evidence. The test is a negative protocol-semantics test, not a
P0-05 pass.

## ATTACK MATRIX

The classifications below apply to the experimental security model, not to an
unimplemented production runtime. `BLOCKED` means the design has a rejecting
control; `DETECTED` means verification or signed-result validation rejects the
mutation; `OUTSIDE CLAIM` means the attack is outside the P0-05 provenance
claim; `UNRESOLVED` means the candidate has no proven control.

| Attack | Candidate A: header | Candidate B: header-less |
| --- | --- | --- |
| Attacker changes Browser request | OUTSIDE CLAIM; the proof claim starts at Prover-owned origin bytes | OUTSIDE CLAIM; same boundary |
| Attacker changes Browser headers | OUTSIDE CLAIM; browser headers are not the authenticated origin request | OUTSIDE CLAIM |
| Attacker changes request before MITM origin serialization | DETECTED if the authenticated binding or transcript no longer matches the FUSOU authority; intent provenance remains outside claim | UNRESOLVED for Session attribution |
| Attacker replaces binding | DETECTED by issued-value and authenticated-transcript checks | BLOCKED as a meaningful header attack; no proven replacement control exists for the Session relation |
| Attacker copies binding from another Session | DETECTED by Session mismatch or single-use state | UNRESOLVED; no authenticated Session value is available to compare |
| Attacker substitutes Session ID | DETECTED by binding Session equality | UNRESOLVED |
| Attacker substitutes Challenge | DETECTED when the authenticated binding nonce differs from the issued nonce | UNRESOLVED when challenge is only local metadata |
| Attacker reuses old proof | DETECTED/BLOCKED by single-use binding and verifier replay state in the synthetic model | UNRESOLVED without a proven proof-to-Session replay registry |
| Attacker reuses old correlation ID | DETECTED when the A binding is consumed | UNRESOLVED; a DB row does not authenticate proof ownership |
| Attacker replays the same request | DETECTED by one-shot transport and binding consumption in the synthetic model | UNRESOLVED for Session attribution even if generic replay detection is added |
| Attacker changes verifier Result | DETECTED only when canonical Result signing and verification are applied; current production signer is absent | DETECTED by the same Result contract, but Session attribution remains unresolved |
| Attacker changes `member_id` | DETECTED when it changes authenticated response bytes or signed Result fields | DETECTED for response/parser and Result integrity, but not sufficient for Session attribution |
| Proof P created under Session B is associated with Session A | BLOCKED/DETECTED: authenticated binding B does not match expected A | UNRESOLVED; naive DB join accepts proof B with Session A metadata |
| Proof A is paired with correlation metadata from Session B | BLOCKED/DETECTED by the authenticated A binding and expected Session check | UNRESOLVED; this is the demonstrated swap attack |

The browser and WebView cases are intentionally not upgraded to stronger
claims. P0-05 authenticates the Prover-owned origin exchange, not browser
intent or provenance.

## COMPARISON

| Property | Candidate A: Header | Candidate B: Header-less |
| --- | --- | --- |
| TLSNotary request binding | `PARTIAL`: synthetic request bytes include the issued value and alpha.15 authenticates the fully disclosed transcript | `NOT ESTABLISHED`: alpha.15 authenticates transcript bytes but no FUSOU Session value |
| Session correlation | `PARTIAL`: FUSOU authority compares authenticated binding to Session/nonce | `BLOCKED`: DB correlation alone is swappable |
| Replay resistance | `PARTIAL`: one-shot transport and single-use binding demonstrated synthetically; runtime registry absent | `UNRESOLVED` for Session attribution |
| Session substitution resistance | `PARTIAL`: mismatch rejected synthetically | `UNRESOLVED` |
| Proof substitution resistance | `PARTIAL`: proof A carries binding A and cannot be consumed as B; real Presentation and authority are absent | `UNRESOLVED`; proof and Session rows can be paired independently |
| Member ID attribution | `PARTIAL`: response-derived ID is protected by authenticated transcript and Result contract; no real FUSOU Presentation | `PARTIAL` for response integrity only; no Session attribution |
| Game Server compatibility | `NOT VERIFIED` | `NOT VERIFIED` for the complete experimental path; no custom header reduces HTTP modification but does not solve correlation |
| Protocol visibility to Game Server | Visible as an unknown header | No custom FUSOU header |
| HTTP modification | Yes, one custom header | No header; any transcript-carried challenge would still modify request bytes |
| Implementation complexity | Moderate: authority, exact serialization, parser, single-use, compatibility validation | Appears lower initially, but requires a new cryptographic correlation authority to be secure |
| Evidence quality | `SYNTHETIC PARTIAL`; actual Prover-owned A harness exists | `SYNTHETIC NEGATIVE`; semantic swap failure is demonstrated, not a qualifying proof |
| Security confidence | Partial for the authenticated-carrier design; compatibility and real authority remain unverified | Low for DB-only correlation; no alpha.15 Session link established |

The name `X-Attestation-Binding` is therefore optional as a label but a
binding carrier is not optional under the current alpha.15 evidence model.

## RECOMMENDATION

`C: CURRENTLY BOTH BLOCKED FOR PRODUCTION`.

Candidate A is the only candidate with a demonstrated cryptographic path from
a FUSOU-issued value to the exact authenticated origin request. It remains an
experimental reference design, not a production contract. Candidate B is not a
safe replacement: its attractive compatibility property is outweighed by the
unresolved proof-to-Session substitution attack.

The next evidence required before selecting A for a real P0-05 implementation
is:

1. an authorized experimental Prover-owned alpha.15 connection to the real Game
   Server;
2. a trusted Session/Challenge authority issuing the exact single-use value;
3. a Real Notary Presentation covering the exact request and response;
4. Dedicated Verifier validation of server identity, ranges, digests, binding,
   and response-derived member ID;
5. controlled evidence of real Game Server behavior with the unknown header;
6. separate privacy, signer, and runtime delivery evidence.

A future header-less design would need a formally specified and independently
verified cryptographic envelope that links Session/Challenge to the proof. A
local DB join, Attestation ID lookup, Game Server cookie, or alpha.15
`ConnectionInfo.time` is not enough.

## FINAL REPORT

```text
Header:
OLD = X-FUSOU-Attestation-Binding
NEW = X-Attestation-Binding

Baseline:
9d343da4abc1865e3d1fb8c9b2e20943006da9d1

Experimental candidate A:
PARTIAL

Experimental candidate B:
BLOCKED

Best current design:
C

Reason:
A has a synthetic authenticated-carrier path and explicit single-use/session
checks, but real Game Server compatibility, Real Notary, and runtime authority
are unverified. B does not cryptographically bind alpha.15 proof output to a
FUSOU Session; a database-only join permits a demonstrated cross-session swap.

Cryptographic Session <-> Proof binding:
PARTIAL

Binding security semantics:
UNCHANGED

Parser:
PASS (new header accepted; missing, duplicate, malformed, and old-header-only
requests rejected)

Replay protection:
PARTIAL (single-use is synthetic; runtime authority is absent)

Synthetic alpha.15 evidence:
PASS

Game Server compatibility:
NOT VERIFIED

Real Game Server:
NOT TESTED

Real Notary:
NOT TESTED

Real Presentation:
NOT TESTED

Dedicated Verifier:
NOT TESTED

Signed Result:
BLOCKED

Production Route:
UNCHANGED

Production Web:
UNCHANGED

Production Proxy:
UNCHANGED

Production APP:
UNCHANGED

Production Hyper/rustls:
UNCHANGED

Production database:
UNCHANGED

Production configuration:
UNCHANGED

Production files changed:
NONE

Experimental files changed:
packages/FUSOU-TLSN-VERIFIER/src/experimental_correlation.rs
packages/FUSOU-TLSN-VERIFIER/src/lib.rs
packages/FUSOU-TLSN-VERIFIER/src/tlsn_alpha15.rs
docs/security/evidence/tlsn-p0-05-session-proof-binding-comparison-2026-09-06.md

docs/security/evidence/tlsn-phase0-gate-ledger-v1.json (synthetic evidence index only)

Current specification/evidence documents renamed to the generic carrier:
docs/implementation-plans/tlsnotary-game-identity-attestation-v1-implementation-plan.md
docs/operations/member-id-preemptive-attack-and-recovery.md
docs/security/evidence/tlsn-natural-capture-audit-report-2026-09-06.md
docs/security/evidence/tlsn-p0-04-p0-05-evidence-attempt-v1.json
docs/security/evidence/tlsn-p0-05-alpha15-adapter-v1.md
docs/security/evidence/tlsn-p0-05-fusou-require-info-evidence-contract-v1.md
docs/security/evidence/tlsn-p0-05-game-client-transport-integration-v1.md
docs/security/evidence/tlsn-p0-05-prover-owned-transport-architecture-v1.md
docs/security/evidence/tlsn-real-environment-handoff-status-v1.md
docs/security/evidence/tlsn-source-inspection-v1.md

P0-05:
BLOCKED

Remaining blockers:
- Real Notary-backed FUSOU Presentation is absent.
- Server-issued binding authority is not connected to a real runtime.
- Real Game Server compatibility with the unknown header is not verified.
- Dedicated Verifier, signer, Web ingestion, privacy, and runtime evidence are absent.
```
