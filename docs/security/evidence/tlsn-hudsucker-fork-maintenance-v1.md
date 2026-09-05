# FUSOU hudsucker Fork Maintenance v1

Status: minimal fork integration implemented for synthetic proof only. This
fork does not enable TLSNotary, production authority, or Phase 0 gate changes.

## Upstream pin

- Repository: `https://github.com/omjadas/hudsucker`
- Package: `hudsucker` `0.23.0`
- Upstream tag: `v0.23.0`
- Upstream commit: `7774ea8cd241560c1dee64376c0f4a9eaed497f0`
- FUSOU fork: `packages/FUSOU-PROXY/hudsucker-fork`
- Consumer: `packages/FUSOU-PROXY/proxy-https`
- Dependency mode: repository-local path dependency
- Proxy lockfile: `packages/FUSOU-PROXY/proxy-https/Cargo.lock`

The fork is copied from the exact upstream package source. Upstream license
and README files remain in the fork. The proxy package lockfile records the
resolved transitive dependency versions and the local path source.

## FUSOU patch surface

The fork adds only the stream lifecycle needed by client-facing plaintext
capture:

- `src/lib.rs`: `HttpContext::connection_id`, `HttpContext::new`, and public
  `ClientStream`, `ClientStreamHook`, and no-op hook types.
- `src/proxy/builder.rs`: optional hook state and
  `with_client_stream_hook` builder method.
- `src/proxy/mod.rs`: per-connection id allocation and hook propagation.
- `src/proxy/internal.rs`: hook state cloning and invocation after
  `TlsAcceptor::accept` succeeds and before Hyper `serve_stream`.

The accepted stream is client-facing MITM TLS plaintext. The hook does not
run for failed TLS handshakes, raw CONNECT tunnels, or the cleartext WebSocket
CONNECT path; HTTPS WebSocket traffic is still carried through the accepted
MITM TLS stream.

FUSOU supplies the hook from `proxy_server_https.rs`. It wraps the stream with
`CaptureIo`, records directional bytes, and finalizes one private exact-wire
artifact after the Hyper connection ends. Only requests whose raw request line
contains `/api_get_member/require_info` are persisted. Handler-visible body
capture is not combined with the raw artifact.

## Upgrade procedure

1. Confirm the intended upstream tag and commit with `git ls-remote`.
2. Copy the new upstream package source into a clean temporary directory.
3. Reapply only the four fork source changes listed above.
4. Re-run the proxy package lockfile update and inspect the hudsucker package
   source entry.
5. Review CONNECT protocol detection, TLS accept, `serve_stream`, Hyper
   upgrades, WebSocket behavior, error paths, and graceful shutdown.
6. Run the fork unit tests and the proxy package tests, including the synthetic
   CONNECT/TLS integration test.
7. Review the diff for accidental registry metadata, generated build output,
   dependency changes, or credential-like material.

A hudsucker version upgrade is not complete until the stream hook remains after
TLS accept and before Hyper parsing, and the synthetic test still proves one
upstream request with matching captured client-facing bytes.

## Regression commands

```text
cargo test --manifest-path packages/FUSOU-PROXY/hudsucker-fork/Cargo.toml --lib
cargo test --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml
cargo check --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml
pnpm run astro check
```

The final command is for the FUSOU-WEB package only when web files are changed;
it is not required for this Rust-only integration.

## Evidence boundary

The synthetic integration proves only that generated client TLS traffic can
travel through CONNECT, the fork's MITM TLS accept, the plaintext hook, Hyper,
and a generated upstream TLS server without request retry. It does not count
as natural Game Client evidence and does not update the Phase 0 ledger:

- natural capture count remains `0`;
- `P0-04 = BLOCKED`;
- `P0-05 = BLOCKED`;
- `IMPLEMENTATION = NO-GO` remains unchanged.

No TLSNotary runtime, verifier, Claim, database migration, production key
registry, Game Server re-submission, or natural credential is part of this
fork integration.
