# TLSNotary P0-05 Implementation Attempt Report

Date: 2026-09-07
Baseline: `9ee8833f4e93ed3c7159e1e76ba2894660e2061a`
Decision: `BLOCKED`

## Scope

This report records the implementation attempt against the required path:

```text
ordinary FUSOU-APP gameplay
  -> FUSOU-MITM actual require_info request
  -> ExperimentalRequireInfoRoute
  -> alpha.15 Prover-owned origin connection
  -> real Game Server
  -> authenticated Presentation
  -> Dedicated Verifier
```

The attempt did not contact the Game Server or a Notary. It did not generate,
inject, replay, retry, or resend a Game Server request. No natural capture was
used as TLSNotary evidence.

## Repository Findings

The current request-selection boundary is present in
`packages/FUSOU-PROXY/proxy-https/src/proxy_server_https.rs`:

- `LogHandler::handle_request` receives the actual MITM request and body.
- `ExperimentalRequireInfoRoute::decide` selects only the first matching
  `POST /kcsapi/api_get_member/require_info`.
- A selected request is returned as a response when forwarding fails closed;
  it is never passed to the Production path.
- `serve_proxy` constructs the route with `forwarder: None`.
- `experimental_tlsn_enabled` remains default-off.

The alpha.15 package contains a usable local transport boundary in
`packages/FUSOU-TLSN-VERIFIER`:

- `ProverOwnedTlsTransport` accepts an already-created alpha.15
  `TlsConnection`.
- It validates the supplied serialized request, writes it once, reads the
  response once, and rejects invalid state transitions.
- The local integration tests use an in-memory synthetic origin and a local
  alpha.15 Verifier session.
- The adapter can verify a serialized Presentation and derive
  `api_member_id` from authenticated response bytes.

That package is not a runtime dependency of `proxy-https`. More importantly,
the repository does not provide the production dependencies needed to create a
qualifying forwarder:

1. No trusted Session/Challenge binding authority is connected to the MITM
   request path.
2. No production server-identity allowlist registry is connected to the
   alpha.15 adapter.
3. No approved Notary endpoint, protocol configuration, or credential is
   available.
4. No Dedicated Verifier service owns the real origin socket and accepts the
   Prover session.
5. No production Result signer or delivery/verification path is connected.

Creating a binding locally, using the natural capture as the request, or
creating a same-process test Verifier would not satisfy the requested trust
boundary. It would also risk classifying synthetic or unauthenticated output as
P0-05 evidence.

## Stop Condition

The requested implementation must stop at this boundary. The missing
interfaces are not optional implementation details:

```text
trusted Session/Challenge authority
  -> one-shot binding delivery before final serialization
  -> Prover-owned alpha.15 connection
  -> Verifier-owned origin socket
  -> approved Notary Presentation
  -> independent Dedicated Verifier
```

Until those services and their trust contracts are supplied, replacing
`forwarder: None` with a repository-local concrete forwarder would either
fabricate authority or send traffic without an independently verifiable
Presentation. Both outcomes are prohibited by the P0-05 requirements.

## Verification Matrix

The following statuses describe this implementation attempt. `PASS` means a
repository property or local negative guarantee was independently checked; it
does not mean that real P0-05 evidence exists.

| # | Requirement | Status | Basis |
| ---: | --- | --- | --- |
| 1 | Actual request originated during ordinary gameplay | BLOCKED | No new operator gameplay run was performed. |
| 2 | Actual request entered the existing FUSOU-MITM pipeline | PARTIAL | The handler boundary is present and natural capture is separately documented; no Experimental real run exists. |
| 3 | Selected request was routed to Experimental TLSN | BLOCKED | The selected route has no configured forwarder. |
| 4 | No standalone request was generated | PASS | The attempted path generated no Game Server traffic; local tests use only synthetic origins. |
| 5 | No duplicate request was sent | PARTIAL | One-shot selection and local transport latches are tested; no real origin counter exists. |
| 6 | Binding was issued by a trusted authority | BLOCKED | No production authority is connected. |
| 7 | Binding was inserted exactly once | BLOCKED | No production pre-serialization injection path exists. |
| 8 | Binding exists in authenticated request bytes | BLOCKED | No FUSOU authenticated Presentation exists. |
| 9 | Prover-owned alpha.15 TLS connection was used | PARTIAL | Synthetic alpha.15 Prover-owned transport tests pass; no production connection exists. |
| 10 | Real Game Server accepted the request | BLOCKED | No Game Server request was sent. |
| 11 | Response came from the corresponding origin connection | BLOCKED | No real Experimental origin exchange exists. |
| 12 | Response was authenticated by TLSNotary | BLOCKED | No real Presentation exists. |
| 13 | Server identity was independently verified | BLOCKED | The production allowlist registry is not connected. |
| 14 | Request transcript was independently verified | BLOCKED | No real FUSOU Presentation exists. |
| 15 | Response transcript was independently verified | BLOCKED | No real FUSOU Presentation exists. |
| 16 | `api_member_id` came from authenticated response bytes | BLOCKED | The parser and synthetic adapter path pass, but no authenticated FUSOU response exists. |
| 17 | Binding was independently verified | BLOCKED | No authority-backed authenticated binding exists. |
| 18 | Dedicated Verifier accepted the Presentation | BLOCKED | No Dedicated Verifier service or real Presentation is available. |
| 19 | Signed Result was generated | BLOCKED | Only unsigned/local Result construction exists. |
| 20 | Signed Result verification succeeded | BLOCKED | No production signed Result exists. |
| 21 | Production route remained unchanged | PASS | The normal Hyper/rustls route remains in place and Experimental TLSN is default-off. |

## Evidence Classification

| Artifact or test | Classification | P0-05 effect |
| --- | --- | --- |
| `FUSOU-TLSN-VERIFIER` unit tests | Local parser/state/adapter validation | No change; synthetic only |
| Local alpha.15 origin tests | `LOCAL_TRANSPORT_INTEGRATION` | No change; synthetic origin and test trust material |
| Existing natural capture audit | `P0-04 NATURAL_CAPTURE` | Does not authenticate the origin TLS transcript |
| Existing audit-AI current-state report | Repository status record | Confirms the same production wiring blocker |
| This report | Implementation stop record | Keeps P0-05 `BLOCKED` |

## Required Inputs Before Resuming

Resume implementation only after all of the following are available and
reviewed:

1. A server-side Session/Challenge authority API that issues and consumes a
   single-use opaque binding.
2. A production allowlist registry for the approved Game Server identity.
3. A Prover/Verifier deployment boundary, including the Verifier-owned origin
   socket and alpha.15 session-driver lifecycle.
4. An approved Notary endpoint and trust/key configuration.
5. A Dedicated Verifier API that accepts the real Presentation and verifies
   server identity, transcript ranges, digests, binding, and the strict
   `require_info` parser independently of MITM state.
6. A production signing and delivery contract for the canonical Result.
7. A privacy-approved private evidence-bundle format and retention policy.

After those inputs exist, the next implementation slice is to replace the
placeholder route forwarder with an injected runtime bridge that receives the
actual selected request, obtains the authority-issued binding before final
serialization, and returns the response from that same Prover-owned origin
connection. The bridge must remain fail-closed when any required dependency is
unavailable and must never fall back to Production after send commitment.

## Final Decision

```text
P0-04 = PASS under the existing natural-capture audit scope
P0-05 = BLOCKED
P0-15 = BLOCKED
TLSNotary production implementation = NO-GO
```
