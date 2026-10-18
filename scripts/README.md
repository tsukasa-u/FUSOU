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
It creates one temporary workspace with sibling `repo`, `hooks`, `template`,
and `analyzer-data` directories. The scoped Git repository contains only the
allowed paths at the checked-out `HEAD` and staged-index snapshots; its hooks,
Git template, and analyzer data remain outside it. Inherited `GIT_*`
environment variables are removed for sandbox commands before explicit
repository-local settings are applied. Both `code-review-graph update` and
`detect-changes --brief` run against the same isolated repository. Staged paths
such as `.empty-hooks/pre-commit`, `.empty-template/hooks/pre-commit`, and
`.code-review-graph/...` remain ordinary scoped files and cannot occupy the
operational directories. The installed `code-review-graph` executable is
required; the hook does not modify or vendor its installation.
