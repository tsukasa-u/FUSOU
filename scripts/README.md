# Repository hooks

Install the tracked pre-commit hook for this checkout with:

```sh
sh scripts/install-scoped-hooks.sh
```

The installer sets only this repository's `core.hooksPath` and refuses to
replace a different configured path. It leaves any existing `.git/hooks`
files untouched.

The managed hook derives its allowlist only from the staged diff. It rejects
the protected APP `configs.toml` and Verifier `wasm.rs` paths before reading
any staged blob, and aborts on an empty scope or staged/worktree mismatch.
It creates a temporary Git repository containing only the allowed paths at
the checked-out `HEAD` and staged-index snapshots, then runs both
`code-review-graph update` and `detect-changes --brief` against that same
isolated repository. The installed `code-review-graph` executable is required;
the hook does not modify or vendor its installation.
