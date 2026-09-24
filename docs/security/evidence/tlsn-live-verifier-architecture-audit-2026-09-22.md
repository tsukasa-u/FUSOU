# TLSNotary Live Verifier Architecture Audit

Date: 2026-09-22

## Conclusion

`REPOSITORY GAP: LIVE FUSOU VERIFIER NOT IMPLEMENTED`

The repository contains a FUSOU-owned live alpha.15 Notary and a FUSOU-owned offline Presentation verifier. It does not contain a FUSOU-owned Worker that participates in the live MPC-TLS Verifier role.

## Role Classification

| Component | Protocol role | Current status |
| --- | --- | --- |
| `FUSOU-APP` / `FUSOU-PROXY` | Prover and origin transport | Implemented; the Prover owns the origin connection |
| `FUSOU-NOTARY` | Delegated alpha.15 MPC Notary | Implemented and FUSOU-operated |
| `FUSOU-TLSN-VERIFICATION-WORKER` | Presentation verification, Result signing, and delivery | Implemented; it is not a live MPC Verifier |
| Requested FUSOU-owned live Verifier Worker | Live alpha.15 MPC Verifier | Not implemented |

The Worker receives a serialized Presentation and passes trusted Notary key material to the Rust/WASM Presentation verifier. It does not create a live alpha.15 `Verifier`, accept `VerifierCommitStart::Mpc`, or participate in the Prover session.

## Notary Dependency

TLSNotary protocol architecture allows a Verifier to participate directly in MPC without a delegated Notary. That makes the Notary optional in the requested future architecture.

The current repository is different: the Prover connects to `FUSOU-NOTARY`, receives a Notary-signed Attestation, builds a Presentation, and the Worker verifies that Presentation with `TLSN_PRODUCTION_NOTARY_REGISTRY` and `TLSN_CANDIDATE_NOTARY_KEY_ID`. The registry and key are therefore required by the current Presentation-verification path. Removing those checks before implementing the live Verifier would weaken the existing cryptographic boundary.

The intake contract records this distinction as:

- `OPTIONAL_DELEGATED_NOTARY`: optional at the protocol architecture level;
- `current_presentation_path: REQUIRED`: required by the implementation that is deployed today.

## Readiness Boundary

The active Canary boundary is the deployment manifest plus fail-closed preflight. It continues to bind the target, canonical profiles, trust root, Notary registry/key, Result and authority registries, deployment identity, binding identity, workflow/current HEAD, and role isolation.

The following are not active deployment prerequisites:

- External Authority approval;
- External Package acceptance or promotion;
- `target-approval` artifacts;
- self-approval rejection semantics;
- User A/device credentials used only for post-deployment remote validation.

Operator-supplied target and authentication configuration remains explicit and validated. It is configuration, not an independent authority claim. Remote validation inputs are retained in the intake inventory and reported as `POST_DEPLOYMENT_ONLY`; they do not populate deployment `missing_inputs` or the deployment authentication gate.

## Security Impact

This repair removes stale governance semantics without removing cryptographic gates. It does not make a Presentation valid without a trusted Notary key, does not change Result signing, does not broaden target or profile acceptance, and does not authorize deployment without a current manifest and passing preflight.

The live Verifier status is explicit in `CANARY_TLSN_ARCHITECTURE`. Readiness tests fail if the repository later claims that the live role exists without an implementation change.

## Validation

The audit and boundary are checked offline with:

```sh
pnpm run test:canary-input-intake
pnpm run test:canary-readiness-contract
node scripts/production-trust-contract-test.mjs
node scripts/canary-deployment-manifest-test.mjs
```

These checks do not contact the Game Server, a Notary, Cloudflare, or any human gameplay path.

## Rollout and Rollback

Rollout is limited to the intake/readiness metadata and its offline contract tests. Existing deployment manifests and preflight contracts remain authoritative. Rollback is a source revert if a consumer requires the previous metadata field names; no deployed Worker or trust registry is changed by this audit.
