import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import scoped_code_review_graph as scope_helper


class ScopedCodeReviewGraphTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fusou-scope-test-")
        self.root = Path(self.temp.name) / "source"
        self.root.mkdir()
        self._git("init", "--quiet")
        self._git("config", "user.name", "scope test")
        self._git("config", "user.email", "scope-test@localhost")
        self._git("config", "core.autocrlf", "false")
        self._write("allowed.py", b"value = 'before'\n")
        self._write("outside.py", b"value = 'outside base'\n")
        self._write(
            "packages/FUSOU-APP/src-tauri/roaming/user/configs.toml",
            b"synthetic protected baseline\n",
        )
        self._write(
            "packages/FUSOU-TLSN-VERIFIER/src/wasm.rs",
            b"// synthetic protected baseline\n",
        )
        self._git("add", "--all")
        self._git("commit", "--quiet", "-m", "base")

    def tearDown(self):
        self.temp.cleanup()

    def _git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.root), *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        ).stdout

    def _write(self, relative_path, content):
        path = self.root.joinpath(*relative_path.split("/"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def _stage(self, relative_path):
        subprocess.run(
            [
                "git",
                "--literal-pathspecs",
                "-C",
                str(self.root),
                "add",
                "--all",
                "--",
                relative_path,
            ],
            check=True,
        )

    def _scope(self):
        return scope_helper.load_staged_scope(self.root)

    def test_only_staged_allowlist_reaches_both_analyzers(self):
        self._write("allowed.py", b"value = 'staged and committed'\n")
        self._stage("allowed.py")
        self._write("outside.py", b"value = 'unstaged outside'\n")
        self._write(
            "packages/FUSOU-TLSN-VERIFIER/src/wasm.rs",
            b"// unstaged protected sentinel\n",
        )
        self._write(
            "packages/FUSOU-APP/src-tauri/roaming/user/configs.toml",
            b"# unstaged protected sentinel\n",
        )
        self._write("untracked.py", b"value = 'untracked outside'\n")

        original_reader = scope_helper._read_allowed_worktree_file
        worktree_reads = []

        def guarded_reader(repo_root, path, allowed_paths):
            self.assertIn(path, allowed_paths)
            worktree_reads.append(path)
            return original_reader(repo_root, path, allowed_paths)

        scope_helper._read_allowed_worktree_file = guarded_reader
        try:
            scope = self._scope()
        finally:
            scope_helper._read_allowed_worktree_file = original_reader
        self.assertEqual(scope.paths, ("allowed.py",))
        self.assertEqual(worktree_reads, ["allowed.py"])
        with tempfile.TemporaryDirectory(prefix="fusou-scope-sandbox-") as sandbox:
            scoped_root, env = scope_helper.create_scoped_repository(scope, sandbox)
            tracked = self._sandbox_tracked_paths(scoped_root, env)
            self.assertEqual(tracked, ["allowed.py"])

            invoked = []

            def recording_runner(command, **kwargs):
                invoked.append(command)
                return subprocess.run(
                    command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    **kwargs,
                )

            executable = shutil.which("code-review-graph")
            if not executable:
                self.skipTest("code-review-graph is unavailable")
            commands = scope_helper.run_analyzers(
                scoped_root, env, executable, recording_runner
            )
            self.assertEqual(invoked, commands)
            self.assertEqual([command[1] for command in invoked], ["update", "detect-changes"])
            self.assertEqual(
                [command[command.index("--repo") + 1] for command in invoked],
                [str(scoped_root), str(scoped_root)],
            )
            self.assertEqual(
                [command[command.index("--base") + 1] for command in invoked],
                ["HEAD~1", "HEAD~1"],
            )

    def test_tracked_pre_commit_entrypoint_runs_scoped_adapter(self):
        if not shutil.which("code-review-graph"):
            self.skipTest("code-review-graph is unavailable")
        self._write("allowed.py", b"value = 'staged hook input'\n")
        self._stage("allowed.py")
        self._write(
            "packages/FUSOU-TLSN-VERIFIER/src/wasm.rs",
            b"// unstaged protected sentinel\n",
        )

        repository = Path(__file__).resolve().parent.parent
        hook = self.root / ".githooks" / "pre-commit"
        adapter = self.root / "scripts" / "scoped_code_review_graph.py"
        hook.parent.mkdir(parents=True)
        adapter.parent.mkdir(parents=True)
        shutil.copyfile(repository / ".githooks" / "pre-commit", hook)
        shutil.copyfile(repository / "scripts" / "scoped_code_review_graph.py", adapter)
        hook.chmod(0o755)
        self._git("config", "core.hooksPath", str(hook.parent))
        analyzer = shutil.which("code-review-graph")
        log = self.root / "analyzer-calls.log"
        wrapper_dir = self.root / "test-bin"
        wrapper_dir.mkdir()
        wrapper = wrapper_dir / "code-review-graph"
        wrapper.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' \"$*\" >> \"$CRG_TEST_LOG\"\n"
            "exec {} \"$@\"\n".format(shlex.quote(analyzer))
        )
        wrapper.chmod(0o755)
        env = os.environ.copy()
        env["PATH"] = str(wrapper_dir) + os.pathsep + env["PATH"]
        env["CRG_TEST_LOG"] = str(log)

        result = subprocess.run(
            ["git", "-C", str(self.root), "commit", "--quiet", "-m", "scoped hook test"],
            cwd=str(self.root),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = log.read_text().splitlines()
        self.assertEqual(len(calls), 2, calls)
        self.assertTrue(calls[0].startswith("update --repo "), calls[0])
        self.assertTrue(calls[1].startswith("detect-changes --brief --repo "), calls[1])

    def test_protected_staged_path_fails_before_blob_or_worktree_reads(self):
        protected_paths = (
            "packages/FUSOU-APP/src-tauri/roaming/user/configs.toml",
            "packages/FUSOU-TLSN-VERIFIER/src/wasm.rs",
        )
        for protected in protected_paths:
            with self.subTest(protected=protected):
                with tempfile.TemporaryDirectory(prefix="fusou-protected-scope-") as temp:
                    root = Path(temp) / "source"
                    root.mkdir()

                    def git(*args):
                        return subprocess.run(
                            ["git", "-C", str(root), *args],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            check=True,
                        ).stdout

                    git("init", "--quiet")
                    git("config", "user.name", "scope test")
                    git("config", "user.email", "scope-test@localhost")
                    path = root.joinpath(*protected.split("/"))
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"synthetic protected baseline\n")
                    git("add", "--", protected)
                    git("commit", "--quiet", "-m", "base")
                    path.write_bytes(b"synthetic staged protected payload\n")
                    subprocess.run(
                        [
                            "git",
                            "--literal-pathspecs",
                            "-C",
                            str(root),
                            "add",
                            "--",
                            protected,
                        ],
                        check=True,
                    )

                    original_blob_reader = scope_helper._read_git_blob
                    original_worktree_reader = scope_helper._read_allowed_worktree_file
                    analyzer_calls = []

                    def fail_if_read(*args, **kwargs):
                        self.fail("content read started before protected-path rejection")

                    def record_analyzer(*args, **kwargs):
                        analyzer_calls.append(args)
                        self.fail("analyzer ran for a protected scope")

                    scope_helper._read_git_blob = fail_if_read
                    scope_helper._read_allowed_worktree_file = fail_if_read
                    try:
                        with self.assertRaisesRegex(
                            scope_helper.ScopeError, "protected path"
                        ):
                            scope_helper.run_scoped_analysis(
                                root,
                                analyzer="test-analyzer",
                                runner=record_analyzer,
                            )
                        self.assertEqual(analyzer_calls, [])
                    finally:
                        scope_helper._read_git_blob = original_blob_reader
                        scope_helper._read_allowed_worktree_file = original_worktree_reader

    def test_empty_scope_fails_without_fallback(self):
        analyzer_calls = []

        def record_analyzer(*args, **kwargs):
            analyzer_calls.append(args)
            return subprocess.CompletedProcess(args[0], 0)

        with self.assertRaisesRegex(scope_helper.ScopeError, "scope is empty"):
            scope_helper.run_scoped_analysis(
                self.root,
                analyzer="test-analyzer",
                runner=record_analyzer,
            )
        self.assertEqual(analyzer_calls, [])

    def test_utf8_spaces_and_newlines_are_preserved(self):
        relative_path = "src/日本語 file\nname.py"
        self._write(relative_path, b"value = 1\n")
        self._stage(relative_path)

        scope = self._scope()
        self.assertEqual(scope.paths, (relative_path,))
        with tempfile.TemporaryDirectory(prefix="fusou-scope-sandbox-") as sandbox:
            scoped_root, env = scope_helper.create_scoped_repository(scope, sandbox)
            self.assertEqual(
                self._sandbox_tracked_paths(scoped_root, env),
                [relative_path],
            )

    def test_delete_rename_and_addition_are_scoped_as_independent_paths(self):
        self._write("rename-source.py", b"value = 'rename source'\n")
        self._write("delete-source.py", b"value = 'delete source'\n")
        self._git("add", "--all")
        self._git("commit", "--quiet", "-m", "extra baseline files")

        (self.root / "rename-source.py").unlink()
        self._write("rename destination.py", b"value = 'renamed staged content'\n")
        (self.root / "delete-source.py").unlink()
        self._write("new 日本語.py", b"value = 'new staged content'\n")
        for path in (
            "rename-source.py",
            "rename destination.py",
            "delete-source.py",
            "new 日本語.py",
        ):
            self._stage(path)

        scope = self._scope()
        self.assertEqual(
            {change.path: change.status for change in scope.changes},
            {
                "rename-source.py": "D",
                "rename destination.py": "A",
                "delete-source.py": "D",
                "new 日本語.py": "A",
            },
        )
        with tempfile.TemporaryDirectory(prefix="fusou-scope-sandbox-") as sandbox:
            scoped_root, env = scope_helper.create_scoped_repository(scope, sandbox)
            self.assertEqual(
                self._sandbox_tracked_paths(scoped_root, env),
                ["new 日本語.py", "rename destination.py"],
            )
            executable = shutil.which("code-review-graph")
            if executable:
                scope_helper.run_analyzers(scoped_root, env, executable)

    def test_worktree_mismatch_fails_closed(self):
        self._write("allowed.py", b"value = 'staged'\n")
        self._stage("allowed.py")
        self._write("allowed.py", b"value = 'unstaged'\n")
        with self.assertRaisesRegex(scope_helper.ScopeError, "differs from the worktree"):
            self._scope()

    def test_allowlist_read_guard_rejects_out_of_scope_path(self):
        with self.assertRaisesRegex(scope_helper.ScopeError, "outside the staged allowlist"):
            scope_helper._read_allowed_worktree_file(
                self.root,
                "outside.py",
                {"allowed.py"},
            )

    def test_path_traversal_and_absolute_paths_are_rejected(self):
        for path in (b"../escape.py", b"/tmp/escape.py", b"dir/../escape.py"):
            with self.subTest(path=path):
                with self.assertRaises(scope_helper.ScopeError):
                    scope_helper._validate_path(path)

    @staticmethod
    def _sandbox_tracked_paths(scoped_root, env):
        output = subprocess.run(
            ["git", "-C", str(scoped_root), "ls-files", "-z"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            check=True,
        ).stdout
        return sorted(path.decode("utf-8") for path in output.split(b"\0") if path)


if __name__ == "__main__":
    unittest.main()
