# TLSN Origin Trust Migration Addendum

Date: 2026-10-02

## Status

This addendum records the local implementation and evidence for separating APP native trust roots from the TLSN Worker’s bundled Mozilla roots, and for selecting Production Origin identities from the shipped 20-host inventory. It supplements the historical Canary readiness audit; it does not revise that audit’s point-in-time status.

No public Origin was contacted, no DNS/TCP/TLS probe was run, and no Worker was deployed for this work. Production authenticity and live trust-store parity remain unverified.

## Trust Boundaries

| Component | Certificate roots | What a successful check establishes |
| --- | --- | --- |
| FUSOU-APP | `rustls_native_certs::load_native_certs()` from the host OS | The native certificate store can be loaded; it does not validate a particular Origin chain |
| TLSN alpha.15 Worker verifier | Bundled Mozilla root set from its default crypto provider | The captured Origin chain, validity, and DNS name verify against that bundled set |
| Production Origin inventory | 20 canonical DNS identities, HTTPS port 443 | A Notary-authenticated Presentation identity is eligible for Production profile selection; it is not a certificate trust anchor |
| Canary | One explicitly configured candidate identity and profile hashes | The deployment remains bound to its fixed Canary target, independently of Production fleet selection |

The APP and Worker stores can diverge. APP handshake success does not imply Worker acceptance. Leaf renewal and intermediate changes generally require no FUSOU change when both stores can validate the new chain. A root absent from the Worker bundle requires changing, rebuilding, and redeploying the verifier. Notary signatures do not replace TLS certificate validation.

## Production Contracts

- Production public manifest schema 3 binds the inventory schema, byte-level SHA-256, target count, and port. It no longer represents a single `server_identity` and `port` pair.
- Deployment-input manifest schema 4 assigns candidate identity/profile inputs to Canary only. Production preflight rejects those static fields and the removed fixed-Origin-port input.
- Security-registry-set contract schema 2 is role-specific. Canary binds its selected identity and complete/sparse profile hashes. Production binds the Notary registry/key, inventory digest, and canonical profile-policy digest.
- Worker task payloads carry a policy derived from Worker runtime configuration: Production uses `inventory`, while Canary uses `fixed`. Production Trigger authenticates the Presentation with the configured Notary key, extracts the server identity, requires an inventory match, and derives the requested profile hash for that identity; Canary uses its separately configured fixed target/profile hashes.
- Trigger deployment configuration requires an explicit `TLSN_TRIGGER_DEPLOYMENT_ROLE`, syncs the fixed identity/profile inputs only for Canary, rejects them for Production, and rejects custom Origin trust roots for both roles.
- Synthetic custom-root verification remains fixture-only. Production Worker and Trigger paths do not accept Origin trust-root DER.

## Observation Tool

The opt-in `tlsn-origin-probe` binary performs TCP/TLS only and records the peer chain after rustls Web PKI validation. It sends no HTTP request, changes no trust configuration, and does not persist trust. A report is an observation of that handshake, not approval or enrollment. Running it against a real host makes outbound DNS/TCP/TLS connections and requires explicit user approval; no real-host invocation is part of this evidence.

## Validation

Local offline checks passed:

- Production public-manifest trust contract, including rejection of an inventory digest mismatch.
- Production preflight/manifest/APP renderer roundtrip with candidate identity, profile hashes, and fixed Origin port omitted.
- Production Worker runtime configuration smoke with those static values absent; `/attestation/session` reached the authentication gate (`401`) rather than the unconfigured response.
- Production security-registry-set tests for inventory/profile-policy binding, Notary-key binding, and exclusion of one candidate identity/profile.
- Trigger inventory/profile tests covering all 20 entries, unknown and fixture host rejection, port 443 selection, and per-host/per-profile digest differences.
- Trigger source and Trigger config TypeScript checks.
- Trigger Origin deployment-role contract tests for Canary fixed inputs and Production inventory-only configuration.
- Earlier in this migration: three generated-certificate probe tests and the Worker-bundled-Mozilla-root divergence test passed.

The full `node scripts/test.mjs` integration harness still stops at the previously observed APP/Worker synthetic E2E `NoBindingAuthority` failure, before reaching its later Worker Production smoke. The isolated Worker Production smoke above passed independently. No unrelated APP E2E behavior was changed in response.

## Rollout and Rollback

Rollout requires deploying the Worker and Trigger code/configuration that understand the inventory-bound contracts, then publishing the schema-v3 Production manifest and matching APP configuration. Canary identity/profile configuration stays fixed and must not be inferred from the Production fleet inventory. Validate live certificate behavior separately in APP and Worker environments before claiming parity.

Rollback is to the prior Worker/Trigger versions and their matching manifest/input schema as a coordinated set. Do not roll back by adding a custom root or hostname-only allow rule to Production. Keep the prior manifest and deployment artifacts available until the previous runtime is restored and verified.