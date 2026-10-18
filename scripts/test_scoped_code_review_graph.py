import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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

    def test_staged_empty_hooks_path_is_not_executed_as_a_hook(self):
        staged_path = ".empty-hooks/pre-commit"
        marker = Path(self.temp.name) / "staged-hook-ran"
        self._write(
            staged_path,
            b"#!/bin/sh\nprintf ran > \"$FUSOU_SCOPED_HOOK_MARKER\"\n",
        )
        self.root.joinpath(*staged_path.split("/")).chmod(0o755)
        self._stage(staged_path)
        scope = self._scope()

        with patch.dict(os.environ, {"FUSOU_SCOPED_HOOK_MARKER": str(marker)}):
            with tempfile.TemporaryDirectory(prefix="fusou-hook-boundary-") as temp:
                scoped_root, env = scope_helper.create_scoped_repository(scope, temp)
                hooks_dir = Path(
                    scope_helper._sandbox_git(
                        scoped_root,
                        ["config", "--path", "--get", "core.hooksPath"],
                        env=env,
                    ).decode().strip()
                )
                hook_file = scoped_root.joinpath(*staged_path.split("/"))
                self.assertEqual(scoped_root, Path(temp) / "repo")
                self.assertEqual(hooks_dir, Path(temp) / "hooks")
                self.assertNotIn(scoped_root, hooks_dir.parents)
                self.assertTrue(os.access(hook_file, os.X_OK))
                self.assertFalse(marker.exists(), "staged hook payload was executed")
                self.assertEqual(
                    self._sandbox_tracked_paths(scoped_root, env),
                    [staged_path],
                )

    def test_staged_template_hook_is_not_used_by_git_init(self):
        staged_path = ".empty-template/hooks/pre-commit"
        marker = Path(self.temp.name) / "template-hook-ran"
        self._write(
            staged_path,
            b"#!/bin/sh\nprintf ran > \"$FUSOU_SCOPED_HOOK_MARKER\"\n",
        )
        self.root.joinpath(*staged_path.split("/")).chmod(0o755)
        self._stage(staged_path)
        scope = self._scope()

        with patch.dict(os.environ, {"FUSOU_SCOPED_HOOK_MARKER": str(marker)}):
            with tempfile.TemporaryDirectory(prefix="fusou-template-boundary-") as temp:
                workspace = Path(temp)
                scoped_root, env = scope_helper.create_scoped_repository(scope, workspace)
                probe = workspace / "template-probe"
                probe.mkdir()
                subprocess.run(
                    [
                        "git",
                        "-C",
                        str(probe),
                        "init",
                        "--quiet",
                        "--template",
                        env["GIT_TEMPLATE_DIR"],
                    ],
                    env=env,
                    check=True,
                )
                subprocess.run(
                    ["git", "-C", str(probe), "config", "user.name", "scope test"],
                    env=env,
                    check=True,
                )
                subprocess.run(
                    ["git", "-C", str(probe), "config", "user.email", "scope-test@localhost"],
                    env=env,
                    check=True,
                )
                (probe / "probe.txt").write_text("template isolation probe\n")
                subprocess.run(
                    ["git", "-C", str(probe), "add", "--", "probe.txt"],
                    env=env,
                    check=True,
                )
                subprocess.run(
                    ["git", "-C", str(probe), "commit", "--quiet", "-m", "probe"],
                    env=env,
                    check=True,
                )
                self.assertFalse(marker.exists(), "staged template hook was executed")
                template_dir = Path(env["GIT_TEMPLATE_DIR"])
                self.assertEqual(template_dir, workspace / "template")
                self.assertNotIn(scoped_root, template_dir.parents)
                self.assertFalse(
                    (probe / ".git" / "hooks" / "pre-commit").exists(),
                    "staged template hook was copied into a new repository",
                )

    def test_staged_code_review_graph_path_is_separate_from_analyzer_data(self):
        if not shutil.which("code-review-graph"):
            self.skipTest("code-review-graph is unavailable")
        staged_path = ".code-review-graph/staged.py"
        self._write(staged_path, b"value = 'staged analyzer path'\n")
        self._stage(staged_path)
        scope = self._scope()

        with tempfile.TemporaryDirectory(prefix="fusou-data-boundary-") as temp:
            workspace = Path(temp)
            scoped_root, env = scope_helper.create_scoped_repository(scope, workspace)
            analyzer_data = Path(env["CRG_DATA_DIR"])
            staged_file = scoped_root.joinpath(*staged_path.split("/"))
            self.assertTrue(staged_file.is_file())
            self.assertEqual(scoped_root, workspace / "repo")
            self.assertEqual(analyzer_data, workspace / "analyzer-data")
            self.assertNotIn(scoped_root, analyzer_data.parents)
            self.assertTrue(analyzer_data.is_dir())
            commands = scope_helper.run_analyzers(
                scoped_root, env, shutil.which("code-review-graph")
            )
            self.assertEqual([command[1] for command in commands], ["update", "detect-changes"])

    def test_sandbox_ignores_injected_git_environment_configuration(self):
        self._write("allowed.py", b"value = 'staged input'\n")
        self._stage("allowed.py")
        scope = self._scope()

        with tempfile.TemporaryDirectory(prefix="fusou-git-env-") as temp:
            workspace = Path(temp)
            injected_env = {
                "GIT_CONFIG_COUNT": "3",
                "GIT_CONFIG_KEY_0": "core.hooksPath",
                "GIT_CONFIG_VALUE_0": str(workspace / "injected-hooks"),
                "GIT_CONFIG_KEY_1": "core.worktree",
                "GIT_CONFIG_VALUE_1": str(self.root),
                "GIT_CONFIG_KEY_2": "core.bare",
                "GIT_CONFIG_VALUE_2": "true",
                "GIT_DIR": str(workspace / "injected.git"),
                "GIT_WORK_TREE": str(self.root),
                "GIT_INDEX_FILE": str(workspace / "injected-index"),
                "GIT_CONFIG_PARAMETERS": "'core.hooksPath=/injected/hooks'",
            }
            with patch.dict(os.environ, injected_env):
                scoped_root, env = scope_helper.create_scoped_repository(scope, workspace)

            self.assertEqual(
                {key for key in env if key.startswith("GIT_")},
                {"GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "GIT_TEMPLATE_DIR"},
            )
            self.assertNotIn("GIT_CONFIG_COUNT", env)
            self.assertFalse(any(key.startswith("GIT_CONFIG_KEY_") for key in env))
            self.assertFalse(any(key.startswith("GIT_CONFIG_VALUE_") for key in env))
            for variable in (
                "GIT_DIR",
                "GIT_WORK_TREE",
                "GIT_INDEX_FILE",
                "GIT_CONFIG_PARAMETERS",
            ):
                self.assertNotIn(variable, env)
            self.assertEqual(
                scope_helper._sandbox_git(
                    scoped_root,
                    ["config", "--path", "--get", "core.hooksPath"],
                    env=env,
                ).decode().strip(),
                str(workspace / "hooks"),
            )
            self.assertEqual(
                scope_helper._sandbox_git(
                    scoped_root, ["rev-parse", "--show-toplevel"], env=env
                ).decode().strip(),
                str(scoped_root),
            )

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
