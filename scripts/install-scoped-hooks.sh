#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
managed_hooks="$repo_root/.githooks"
current_hooks=$(git -C "$repo_root" config --get core.hooksPath || true)

if [ -n "$current_hooks" ] && [ "$current_hooks" != "$managed_hooks" ]; then
    printf '%s\n' \
        "Refusing to replace existing core.hooksPath: $current_hooks" >&2
    exit 1
fi

if [ ! -x "$managed_hooks/pre-commit" ]; then
    printf '%s\n' "Managed pre-commit hook is missing or not executable." >&2
    exit 1
fi

git -C "$repo_root" config --local core.hooksPath "$managed_hooks"
printf 'Installed repository-managed hooks from %s\n' "$managed_hooks"
