# Isolated Proxy capture test harness

This standalone crate uses small `include!` wrappers for the Proxy's actual
`experimental_tlsn.rs`, `exchange_lifecycle.rs`, and nested lifecycle test
source. No source or test implementation is copied into this harness.

This is a focused unit-test/type-check harness, not a build or integration test
of the complete `proxy-https` package. It intentionally excludes that package's
build script and dependencies, including the protected APP configuration path.

The direct dependency versions are pinned to those resolved by
`proxy-https/Cargo.lock` for the corresponding dependencies. This harness has
its own `Cargo.lock`; update it with `cargo +1.98.1 generate-lockfile` when
intentionally changing this harness's dependency manifest, using
`--manifest-path packages/FUSOU-PROXY/proxy-https/capture-test-harness/Cargo.toml`,
and keep the pins aligned with the Proxy lock.

From the repository root, fetch the locked dependencies and run the checks:

```sh
cargo +1.98.1 fetch --locked \
  --manifest-path packages/FUSOU-PROXY/proxy-https/capture-test-harness/Cargo.toml
cargo +1.98.1 check --locked --offline --lib \
  --manifest-path packages/FUSOU-PROXY/proxy-https/capture-test-harness/Cargo.toml
cargo +1.98.1 test --locked --offline --lib \
  --manifest-path packages/FUSOU-PROXY/proxy-https/capture-test-harness/Cargo.toml
```
