import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  prepareCaptureOutput,
  recoverConfigFromMarker,
  resolveCaptureOutputPath,
  restoreConfig,
  withCaptureConfig,
  waitForChildWithSignalForwarding,
  writeConfigRecoveryMarker,
} from "./testplay-verify.mjs";

test("clean-capture config overrides every targeted setting", () => {
  const original = [
    "[proxy]",
    "allow_save_api_requests = true",
    "allow_save_api_requests = true",
    "capture_enabled = false",
    "",
    "[app.auth]",
    "deny_auth = false",
    "allow_anonymous_auth_bootstrap = false",
    "allow_pending_upload_retry = true",
    "",
    "[app.database]",
    "allow_data_to_cloud = true",
    "",
  ].join("\r\n");

  const updated = withCaptureConfig(original, "/tmp/private-capture");

  for (const setting of [
    "allow_save_api_requests",
    "allow_save_api_responses",
    "allow_save_resources",
    "allow_save_main_js_local",
    "capture_enabled",
  ]) {
    assert.match(updated, new RegExp(`^${setting} = (?:true|false|"[^"]+")$`, "m"));
  }
  assert.match(updated, /\[proxy\.tlsn\][\s\S]*?^enabled = false$/m);
  for (const setting of [
    "allow_data_to_cloud",
    "allow_data_to_shared_cloud",
    "allow_data_to_local",
    "asset_upload_enable",
  ]) {
    assert.match(updated, new RegExp(`^${setting} = false$`, "m"));
  }
  assert.match(updated, /^deny_auth = false$/m);
  assert.match(updated, /^allow_anonymous_auth_bootstrap = false$/m);
  assert.match(updated, /^allow_pending_upload_retry = true$/m);
  for (const section of [
    "app.quest_tree_sender",
    "app.ship_growth_sender",
    "app.soku_speed_sender",
    "app.remodel_sender",
  ]) {
    assert.match(updated, new RegExp(`\\[${section.replaceAll(".", "\\.")}\\]`));
    assert.match(updated, new RegExp(`\\[${section.replaceAll(".", "\\.")}\\][\\s\\S]*?enable = false`));
  }
  assert.match(updated, /^capture_output_path = \"\/tmp\/private-capture\"$/m);
  assert.ok(updated.endsWith("\r\n"));
});

test("TLSN candidate mode is explicit and separates natural and proof artifacts", () => {
  const updated = withCaptureConfig("[proxy]\n[proxy.tlsn]\n", "/tmp/private-candidate", {
    tlsnCandidate: true,
  });

  assert.match(updated, /^capture_output_path = "\/tmp\/private-candidate\/natural"$/m);
  assert.match(updated, /^enabled = true$/m);
  assert.match(updated, /^candidate_capture_enabled = true$/m);
  assert.match(updated, /^deny_auth = false$/m);
  assert.match(updated, /^allow_anonymous_auth_bootstrap = false$/m);
  assert.match(updated, /^allow_pending_upload_retry = false$/m);
  assert.match(updated, /^artifact_output_path = "\/tmp\/private-candidate\/tlsn"$/m);
});

test("ordinary capture leaves absent Auth settings absent", () => {
  const updated = withCaptureConfig("[proxy]\n", "/tmp/private-capture");

  assert.doesNotMatch(updated, /^\[app\.auth\]$/m);
  assert.doesNotMatch(updated, /^deny_auth\s*=/m);
  assert.doesNotMatch(updated, /^allow_anonymous_auth_bootstrap\s*=/m);
  assert.doesNotMatch(updated, /^allow_pending_upload_retry\s*=/m);
});

test("candidate output is private, created exclusively, and rejects reused roots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-candidate-output-"));
  const outputPath = path.join(root, "new", "capture");

  try {
    await prepareCaptureOutput(outputPath, { tlsnCandidate: true });
    assert.equal((await stat(outputPath)).mode & 0o077, 0);
    await assert.rejects(
      prepareCaptureOutput(outputPath, { tlsnCandidate: true }),
      /empty directory/,
    );

    if (process.platform !== "win32") {
      const publicPath = path.join(root, "public");
      await mkdir(publicPath);
      await chmod(publicPath, 0o755);
      await assert.rejects(prepareCaptureOutput(publicPath), /permissions must be private/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture output resolution rejects symlink parents into the repository", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-capture-path-"));
  const repositoryPath = path.join(root, "repository");
  const repositoryAlias = path.join(root, "repository-alias");

  try {
    await mkdir(repositoryPath);
    await symlink(repositoryPath, repositoryAlias);
    await assert.rejects(
      resolveCaptureOutputPath(path.join(repositoryAlias, "capture"), repositoryPath),
      /resolve outside the repository/,
    );

    assert.equal(
      await resolveCaptureOutputPath(path.join(root, "external", "capture"), repositoryPath),
      path.join(root, "external", "capture"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("config restoration preserves exact bytes and removes absent config", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-testplay-"));
  const configPath = path.join(root, "configs.toml");
  const original = "[proxy]\r\nallow_save_api_requests = true\r\n";

  try {
    await writeFile(configPath, "temporary override\n", "utf8");
    await restoreConfig(configPath, original);
    assert.equal(await readFile(configPath, "utf8"), original);

    await restoreConfig(configPath, null);
    await assert.rejects(readFile(configPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale recovery marker restores exact config bytes and mode", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-testplay-recovery-"));
  const configPath = path.join(root, "configs.toml");
  const markerPath = path.join(root, ".testplay-verify-recovery.json");
  const original = "[proxy]\r\ncapture_enabled = false\r\n";

  try {
    await writeFile(configPath, original, { mode: 0o640 });
    const originalMode = (await stat(configPath)).mode & 0o7777;
    await writeConfigRecoveryMarker(markerPath, original, originalMode);
    await writeFile(configPath, "temporary capture config\n");

    assert.equal(await recoverConfigFromMarker(configPath, markerPath), true);
    assert.equal(await readFile(configPath, "utf8"), original);
    if (process.platform !== "win32") {
      assert.equal((await stat(configPath)).mode & 0o7777, originalMode);
    }
    await assert.rejects(stat(markerPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale recovery marker removes config when it was originally absent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-testplay-recovery-absent-"));
  const configPath = path.join(root, "configs.toml");
  const markerPath = path.join(root, ".testplay-verify-recovery.json");

  try {
    await writeConfigRecoveryMarker(markerPath, null, null);
    await writeFile(configPath, "temporary capture config\n");

    assert.equal(await recoverConfigFromMarker(configPath, markerPath), true);
    await assert.rejects(stat(configPath), { code: "ENOENT" });
    await assert.rejects(stat(markerPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("launcher forwards termination signals and removes handlers after child exit", async () => {
  class FakeChild extends EventEmitter {
    exitCode = null;
    signals = [];

    kill(signal) {
      this.signals.push(signal);
    }
  }

  const child = new FakeChild();
  const signalSource = new EventEmitter();
  const closed = waitForChildWithSignalForwarding(child, signalSource);
  signalSource.emit("SIGINT");
  signalSource.emit("SIGTERM");
  assert.deepEqual(child.signals, ["SIGINT", "SIGTERM"]);

  child.emit("close", null, "SIGTERM");
  assert.equal(await closed, 1);
  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
});