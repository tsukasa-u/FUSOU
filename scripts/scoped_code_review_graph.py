#!/usr/bin/env python3
"""Run code-review-graph only against the commit's staged file scope."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
PROTECTED_PATHS = {
    "packages/FUSOU-APP/src-tauri/roaming/user/configs.toml",
    "packages/FUSOU-TLSN-VERIFIER/src/wasm.rs",
}
REGULAR_MODES = {"100644", "100755"}


class ScopeError(Exception):
    pass


class StagedChange:
    def __init__(self, path, status, old_mode, new_mode, old_oid, new_oid):
        self.path = path
        self.status = status
        self.old_mode = old_mode
        self.new_mode = new_mode
        self.old_oid = old_oid
        self.new_oid = new_oid


class StagedScope:
    def __init__(self, changes, staged_blobs, base_blobs):
        self.changes = tuple(changes)
        self.staged_blobs = staged_blobs
        self.base_blobs = base_blobs

    @property
    def paths(self):
        return tuple(change.path for change in self.changes)


def _run_git(repo_root, args, *, input_bytes=None, literal_pathspecs=False, env=None):
    command = ["git"]
    if literal_pathspecs:
        command.append("--literal-pathspecs")
    command.extend(["-C", str(repo_root), *args])
    result = subprocess.run(
        command,
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(repo_root),
        env=env,
        check=False,
    )
    if result.returncode:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise ScopeError(
            "git command failed ({}){}".format(
                " ".join(command[1:]),
                ": {}".format(detail) if detail else "",
            )
        )
    return result.stdout


def _validate_path(path_bytes):
    try:
        path = path_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ScopeError("staged path is not valid UTF-8") from error

    components = path.split("/")
    if (
        not path
        or path.startswith("/")
        or "\\" in path
        or ":" in path
        or any(component in ("", ".", "..") for component in components)
        or ".git" in components
    ):
        raise ScopeError("staged path is not a safe repository-relative path")
    return path


def _is_zero_oid(object_id):
    return len(object_id) in (40, 64) and set(object_id) == {"0"}


def _is_valid_oid(object_id):
    return len(object_id) in (40, 64) and all(
        character in "0123456789abcdef" for character in object_id
    )


def _parse_raw_diff(raw):
    fields = raw.split(b"\0")
    changes = []
    index = 0
    while index < len(fields) - 1:
        header = fields[index]
        path_bytes = fields[index + 1]
        index += 2
        if not header:
            continue
        if not header.startswith(b":"):
            raise ScopeError("staged diff contains an unexpected record")
        metadata = header[1:].split()
        if len(metadata) != 5:
            raise ScopeError("staged diff record is malformed")
        old_mode, new_mode, old_oid, new_oid, status = (
            value.decode("ascii", "strict") for value in metadata
        )
        if status not in {"A", "M", "D"}:
            raise ScopeError("staged rename, copy, conflict, or type change is unsupported")
        path = _validate_path(path_bytes)
        changes.append(
            StagedChange(path, status, old_mode, new_mode, old_oid, new_oid)
        )
    return changes


def _validate_change_metadata(changes):
    seen = set()
    for change in changes:
        if change.path in seen:
            raise ScopeError("staged diff contains a duplicate path")
        seen.add(change.path)
        if not all(
            _is_valid_oid(object_id)
            for object_id in (change.old_oid, change.new_oid)
        ):
            raise ScopeError("staged diff contains an invalid object ID")
        if change.status == "A":
            valid = (
                change.old_mode == "000000"
                and _is_zero_oid(change.old_oid)
                and change.new_mode in REGULAR_MODES
                and not _is_zero_oid(change.new_oid)
            )
        elif change.status == "D":
            valid = (
                change.old_mode in REGULAR_MODES
                and not _is_zero_oid(change.old_oid)
                and change.new_mode == "000000"
                and _is_zero_oid(change.new_oid)
            )
        else:
            valid = (
                change.old_mode in REGULAR_MODES
                and change.new_mode in REGULAR_MODES
                and not _is_zero_oid(change.old_oid)
                and not _is_zero_oid(change.new_oid)
            )
        if not valid:
            raise ScopeError("staged path is not a regular file change")


def _open_parent_directory(repo_root, path):
    if (
        os.name != "posix"
        or not hasattr(os, "O_NOFOLLOW")
        or not hasattr(os, "O_DIRECTORY")
        or os.open not in os.supports_dir_fd
    ):
        raise ScopeError("safe scoped reads are unsupported on this platform")

    parts = path.split("/")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    parent_fd = os.open(str(repo_root), flags)
    try:
        for component in parts[:-1]:
            next_fd = os.open(component, flags, dir_fd=parent_fd)
            os.close(parent_fd)
            parent_fd = next_fd
    except BaseException:
        os.close(parent_fd)
        raise
    return parent_fd, parts[-1]


def _read_allowed_worktree_file(repo_root, path, allowed_paths):
    if path not in allowed_paths:
        raise ScopeError("attempted to read a path outside the staged allowlist")
    parent_fd, leaf = _open_parent_directory(repo_root, path)
    flags = os.O_RDONLY | os.O_NOFOLLOW
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    try:
        file_fd = os.open(leaf, flags, dir_fd=parent_fd)
        try:
            if not stat.S_ISREG(os.fstat(file_fd).st_mode):
                raise ScopeError("staged path is not a regular worktree file")
            with os.fdopen(file_fd, "rb", closefd=False) as file_obj:
                return file_obj.read()
        finally:
            os.close(file_fd)
    finally:
        os.close(parent_fd)


def _assert_deleted_path_absent(repo_root, path):
    try:
        parent_fd, leaf = _open_parent_directory(repo_root, path)
    except FileNotFoundError:
        return
    try:
        try:
            os.stat(leaf, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        raise ScopeError("staged deletion differs from the worktree")
    finally:
        os.close(parent_fd)


def _read_git_blob(repo_root, object_id):
    return _run_git(repo_root, ["cat-file", "blob", object_id])


def load_staged_scope(repo_root):
    raw = _run_git(
        repo_root,
        [
            "diff",
            "--cached",
            "--raw",
            "-z",
            "--no-abbrev",
            "--no-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--",
        ],
    )
    changes = _parse_raw_diff(raw)
    _validate_change_metadata(changes)

    protected = sorted(PROTECTED_PATHS.intersection(change.path for change in changes))
    if protected:
        raise ScopeError("protected path is staged; analyzer was not started")
    if not changes:
        raise ScopeError("staged file scope is empty; analyzer was not started")

    unmerged = _run_git(repo_root, ["ls-files", "--unmerged", "-z"])
    if unmerged:
        raise ScopeError("unmerged index entries prevent a safe staged scope")

    allowed_paths = {change.path for change in changes}
    staged_blobs = {}
    base_blobs = {}
    for change in changes:
        if change.status == "D":
            _assert_deleted_path_absent(repo_root, change.path)
        else:
            staged_blob = _read_git_blob(repo_root, change.new_oid)
            worktree_blob = _read_allowed_worktree_file(
                repo_root, change.path, allowed_paths
            )
            if staged_blob != worktree_blob:
                raise ScopeError(
                    "staged content differs from the worktree for an allowed path"
                )
            staged_blobs[change.path] = staged_blob

        if change.status != "A":
            base_blobs[change.path] = _read_git_blob(repo_root, change.old_oid)

    return StagedScope(changes, staged_blobs, base_blobs)


def _sandbox_path(root, path):
    return root.joinpath(*path.split("/"))


def _write_sandbox_file(root, path, content, mode):
    destination = _sandbox_path(root, path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    destination.chmod(0o755 if mode == "100755" else 0o644)


def _remove_sandbox_path(root, path):
    target = _sandbox_path(root, path)
    try:
        mode = target.lstat().st_mode
    except FileNotFoundError:
        mode = None
    if mode is not None and stat.S_ISREG(mode):
        target.unlink()
    elif mode is not None and stat.S_ISDIR(mode):
        try:
            target.rmdir()
        except OSError:
            pass
    elif mode is not None:
        raise ScopeError("temporary snapshot contains an unexpected file type")
    parent = target.parent
    while parent != root:
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent


def _sandbox_git(repo_root, args, *, literal_pathspecs=False, env=None):
    return _run_git(
        repo_root, args, literal_pathspecs=literal_pathspecs, env=env
    )


def create_scoped_repository(scope, destination):
    workspace = Path(destination)
    workspace.mkdir(parents=True, exist_ok=True)
    workspace = workspace.resolve()
    scoped_root = workspace / "repo"
    scoped_root.mkdir()
    hooks_dir = workspace / "hooks"
    hooks_dir.mkdir()
    template_dir = workspace / "template"
    template_dir.mkdir()
    analyzer_data_dir = workspace / "analyzer-data"
    analyzer_data_dir.mkdir()

    env = {
        key: value for key, value in os.environ.items() if not key.startswith("GIT_")
    }
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_TEMPLATE_DIR"] = str(template_dir)
    env["CRG_REPO_ROOT"] = str(scoped_root)
    env["CRG_DATA_DIR"] = str(analyzer_data_dir)

    _sandbox_git(
        scoped_root,
        ["init", "--quiet", "--template", str(template_dir)],
        env=env,
    )
    for key, value in (
        ("user.name", "FUSOU scoped pre-commit"),
        ("user.email", "scoped-pre-commit@localhost"),
        ("core.hooksPath", str(hooks_dir)),
        ("diff.renames", "false"),
        ("commit.gpgsign", "false"),
    ):
        _sandbox_git(scoped_root, ["config", key, value], env=env)

    for change in scope.changes:
        if change.status != "A":
            _write_sandbox_file(
                scoped_root,
                change.path,
                scope.base_blobs[change.path],
                change.old_mode,
            )
    for change in scope.changes:
        if change.status != "A":
            _sandbox_git(
                scoped_root,
                ["add", "--", change.path],
                literal_pathspecs=True,
                env=env,
            )
    _sandbox_git(
        scoped_root,
        ["commit", "--quiet", "--allow-empty", "-m", "scoped base"],
        env=env,
    )

    for change in scope.changes:
        _remove_sandbox_path(scoped_root, change.path)
    for change in scope.changes:
        if change.status != "D":
            _write_sandbox_file(
                scoped_root,
                change.path,
                scope.staged_blobs[change.path],
                change.new_mode,
            )
    for change in scope.changes:
        _sandbox_git(
            scoped_root,
            ["add", "--all", "--", change.path],
            literal_pathspecs=True,
            env=env,
        )
    _sandbox_git(
        scoped_root,
        ["commit", "--quiet", "--allow-empty", "-m", "staged snapshot"],
        env=env,
    )
    return scoped_root, env


def run_analyzers(scoped_root, env, analyzer=None, runner=None):
    analyzer = analyzer or shutil.which("code-review-graph")
    if not analyzer:
        raise ScopeError("code-review-graph executable is unavailable")
    runner = runner or subprocess.run
    common = ["--repo", str(scoped_root), "--base", "HEAD~1"]
    commands = [
        [analyzer, "update", *common],
        [analyzer, "detect-changes", "--brief", *common],
    ]
    for command in commands:
        result = runner(
            command,
            cwd=str(scoped_root),
            env=env,
            check=False,
        )
        if result.returncode:
            raise ScopeError(
                "scoped code-review-graph command failed: {}".format(command[1])
            )
    return commands


def run_scoped_analysis(repo_root, analyzer=None, runner=None, scope_callback=None):
    scope = load_staged_scope(repo_root)
    if scope_callback:
        scope_callback(scope)
    with tempfile.TemporaryDirectory(prefix="fusou-scoped-review-") as temporary:
        scoped_root, env = create_scoped_repository(scope, temporary)
        return run_analyzers(scoped_root, env, analyzer, runner)


def main():
    try:
        run_scoped_analysis(
            REPOSITORY_ROOT,
            scope_callback=lambda scope: print(
                "Scoped code review: {} staged path(s)".format(len(scope.paths)),
                flush=True,
            ),
        )
    except ScopeError as error:
        print("pre-commit scope rejected: {}".format(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
