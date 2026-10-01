import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const recoveryModuleUrl = new URL("./testplay-verify.mjs", import.meta.url).href;

function spawnRecoveryProcess(source, markerPath) {
  return spawn(process.execPath, ["--input-type=module", "-e", source], {
    env: { ...process.env, FUSOU_TEST_RECOVERY_MARKER: markerPath },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function waitForProcessOutput(child, expected) {
  return new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(expected)) {
        cleanup();
        resolve(output);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code) => {
      cleanup();
      reject(new Error(`recovery process exited ${code}: ${output}`));
    };
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("close", onClose);
    };
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

function waitForProcessClose(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function runRecoveryProcess(source, markerPath) {
  const child = spawnRecoveryProcess(source, markerPath);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  return waitForProcessClose(child).then((code) => ({ code, stdout, stderr }));
}

import {
  prepareCaptureOutput,
  recoverConfigFromMarker,
  resolveCaptureOutputPath,
  restoreConfig,
  withCaptureConfig,
  waitForChildWithSignalForwarding,
  writeConfigRecoveryMarker,
} from "./testplay-verify.mjs";

async function writeStaleRecoveryMarker(markerPath, original, mode) {
  return writeConfigRecoveryMarker(markerPath, original, mode, {
    launcherPid: 0x7fff_ffff,
  });
}

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
  const original = Buffer.from('[proxy]\r\ncapture_enabled = false\r\nname = "海"\n', "utf8");

  try {
    await writeFile(configPath, original, { mode: 0o640 });
    const originalMode = (await stat(configPath)).mode & 0o7777;
    await writeStaleRecoveryMarker(markerPath, original, originalMode);
    await writeFile(configPath, "temporary capture config\n");

    assert.equal(await recoverConfigFromMarker(configPath, markerPath), true);
    assert.deepEqual(await readFile(configPath), original);
    if (process.platform !== "win32") {
      assert.equal((await stat(configPath)).mode & 0o777, originalMode);
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
    await writeStaleRecoveryMarker(markerPath, null, null);
    await writeFile(configPath, "temporary capture config\n");

    assert.equal(await recoverConfigFromMarker(configPath, markerPath), true);
    await assert.rejects(stat(configPath), { code: "ENOENT" });
    await assert.rejects(stat(markerPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovery restores after marker creation before temporary config write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-testplay-recovery-before-write-"));
  const configPath = path.join(root, "configs.toml");
  const markerPath = path.join(root, ".testplay-verify-recovery.json");
  const original = Buffer.from("[proxy]\n", "utf8");

  try {
    await writeFile(configPath, original, { mode: 0o640 });
    await writeStaleRecoveryMarker(markerPath, original, 0o640);
    assert.equal(await recoverConfigFromMarker(configPath, markerPath), true);
    assert.deepEqual(await readFile(configPath), original);
    await assert.rejects(stat(markerPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovery retries after an orphan restore temp and removes capture temps", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-testplay-recovery-orphan-"));
  const configPath = path.join(root, "configs.toml");
  const markerPath = path.join(root, ".testplay-verify-recovery.json");
  const original = Buffer.from("[proxy]\r\n", "utf8");
  const orphanRestore = path.join(root, `.configs.toml.restore-${randomUUID()}`);
  const orphanCapture = path.join(root, `.configs.toml.capture-${randomUUID()}`);
  const orphanMarker = path.join(root, `.testplay-verify-recovery-${randomUUID()}`);

  try {
    await writeFile(configPath, "temporary config", { mode: 0o600 });
    await writeFile(orphanRestore, "partial restore", { mode: 0o600 });
    await writeFile(orphanCapture, "partial capture", { mode: 0o600 });
    await writeFile(orphanMarker, "partial marker", { mode: 0o600 });
    await writeStaleRecoveryMarker(markerPath, original, 0o640);
    assert.equal(await recoverConfigFromMarker(configPath, markerPath), true);
    assert.deepEqual(await readFile(configPath), original);
    await assert.rejects(stat(orphanRestore), { code: "ENOENT" });
    await assert.rejects(stat(orphanCapture), { code: "ENOENT" });
    await assert.rejects(stat(orphanMarker), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovery rejects marker symlinks, config symlinks, and non-private markers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-testplay-recovery-links-"));
  const configPath = path.join(root, "configs.toml");
  const markerPath = path.join(root, ".testplay-verify-recovery.json");
  const outside = path.join(root, "outside");

  try {
    await writeFile(outside, "outside", { mode: 0o600 });
    await symlink(outside, markerPath);
    await assert.rejects(recoverConfigFromMarker(configPath, markerPath), /regular file/);
    await rm(markerPath);

    await writeStaleRecoveryMarker(markerPath, Buffer.from("original"), 0o600);
    await symlink(outside, configPath);
    await assert.rejects(recoverConfigFromMarker(configPath, markerPath), /regular file/);
    assert.equal(await readFile(outside, "utf8"), "outside");
    await rm(configPath);

    if (process.platform !== "win32") {
      await chmod(markerPath, 0o644);
      await assert.rejects(recoverConfigFromMarker(configPath, markerPath), /permissions must be private/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovery rejects malformed, inconsistent, noncanonical, oversized, and wrong-schema markers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-testplay-recovery-invalid-"));
  const configPath = path.join(root, "configs.toml");
  const markerPath = path.join(root, ".testplay-verify-recovery.json");
  const original = Buffer.from("original");

  try {
    await writeFile(configPath, "temporary", { mode: 0o600 });
    await writeStaleRecoveryMarker(markerPath, original, 0o600);
    await writeFile(markerPath, "not json", { mode: 0o600 });
    await assert.rejects(recoverConfigFromMarker(configPath, markerPath), /malformed/);
    await rm(markerPath);

    for (const mutation of [
      (marker) => ({ ...marker, schema_version: 99 }),
      (marker) => ({ ...marker, original_mode: null }),
      (marker) => ({ ...marker, original_config_base64: "YR==" }),
      (marker) => ({ ...marker, launcher_pid: 0 }),
      (marker) => ({ ...marker, capture_token: "not-a-uuid" }),
    ]) {
      await writeStaleRecoveryMarker(markerPath, original, 0o600);
      const marker = JSON.parse(await readFile(markerPath, "utf8"));
      await writeFile(markerPath, JSON.stringify(mutation(marker)), { mode: 0o600 });
      await assert.rejects(recoverConfigFromMarker(configPath, markerPath));
      await rm(markerPath);
    }

    await writeStaleRecoveryMarker(markerPath, original, 0o600);
    await writeFile(markerPath, Buffer.alloc(6 * 1024 * 1024 + 1), { mode: 0o600 });
    await assert.rejects(recoverConfigFromMarker(configPath, markerPath), /size limit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("active capture is exclusive and only its token may preserve temporary config", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-testplay-recovery-active-"));
  const configPath = path.join(root, "configs.toml");
  const markerPath = path.join(root, ".testplay-verify-recovery.json");
  const original = Buffer.from("original\r\n", "utf8");

  try {
    await writeFile(configPath, original, { mode: 0o600 });
    const token = await writeConfigRecoveryMarker(markerPath, original, 0o600, {
      launcherPid: process.pid,
    });
    await writeFile(configPath, "candidate", { mode: 0o600 });
    const markerBefore = await readFile(markerPath);
    await assert.rejects(
      writeConfigRecoveryMarker(markerPath, Buffer.from("replacement"), 0o600),
      { code: "EEXIST" },
    );
    assert.deepEqual(await readFile(markerPath), markerBefore);
    await assert.rejects(recoverConfigFromMarker(configPath, markerPath), /active/);
    assert.equal(await recoverConfigFromMarker(configPath, markerPath, { authorizedToken: token }), false);
    assert.equal(await readFile(configPath, "utf8"), "candidate");
    assert.equal(await recoverConfigFromMarker(configPath, markerPath, {
      authorizedToken: token,
      restoreActive: true,
    }), true);
    assert.deepEqual(await readFile(configPath), original);
    await assert.rejects(stat(markerPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an explicit unknown recovery token cannot fall through to stale recovery", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-testplay-recovery-unknown-token-"));
  const configPath = path.join(root, "configs.toml");
  const markerPath = path.join(root, ".testplay-verify-recovery.json");
  const original = Buffer.from("original\r\n", "utf8");

  try {
    await writeFile(configPath, "temporary capture config\n", { mode: 0o600 });
    await writeStaleRecoveryMarker(markerPath, original, 0o600);
    await assert.rejects(
      recoverConfigFromMarker(configPath, markerPath, {
        authorizedToken: "00000000-0000-4000-8000-000000000000",
      }),
      /token is not authorized/,
    );
    assert.equal(await readFile(configPath, "utf8"), "temporary capture config\n");
    await stat(markerPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("separate launcher processes serialize marker creation and block on a live PID", {
  timeout: 10_000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-testplay-recovery-processes-"));
  const configPath = path.join(root, "configs.toml");
  const markerPath = path.join(root, ".testplay-verify-recovery.json");
  const holderSource = `import { writeConfigRecoveryMarker } from ${JSON.stringify(recoveryModuleUrl)}; await writeConfigRecoveryMarker(process.env.FUSOU_TEST_RECOVERY_MARKER, "original", 0o600, { launcherPid: process.pid }); process.stdout.write("created"); process.stdin.resume();`;
  const contenderSource = `import { writeConfigRecoveryMarker } from ${JSON.stringify(recoveryModuleUrl)}; try { await writeConfigRecoveryMarker(process.env.FUSOU_TEST_RECOVERY_MARKER, "replacement", 0o600); process.stdout.write("created"); } catch (error) { if (error.code === "EEXIST") process.stdout.write("exists"); else throw error; }`;
  const recoverySource = `import { recoverConfigFromMarker } from ${JSON.stringify(recoveryModuleUrl)}; try { await recoverConfigFromMarker(process.env.FUSOU_TEST_RECOVERY_MARKER.replace(/\\.testplay-verify-recovery\\.json$/, "configs.toml"), process.env.FUSOU_TEST_RECOVERY_MARKER); process.exitCode = 1; } catch (error) { if (/active/.test(error.message)) process.stdout.write("blocked"); else throw error; }`;
  let holder;

  try {
    await writeFile(configPath, "temporary", { mode: 0o600 });
    holder = spawnRecoveryProcess(holderSource, markerPath);
    assert.match(await waitForProcessOutput(holder, "created"), /created/);

    const contender = await runRecoveryProcess(contenderSource, markerPath);
    assert.equal(contender.code, 0, contender.stderr);
    assert.equal(contender.stdout, "exists");

    const blockedRecovery = await runRecoveryProcess(recoverySource, markerPath);
    assert.equal(blockedRecovery.code, 0, blockedRecovery.stderr);
    assert.equal(blockedRecovery.stdout, "blocked");
  } finally {
    if (holder && holder.exitCode === null) {
      holder.kill("SIGTERM");
      await waitForProcessClose(holder);
    }
  }

  try {
    assert.equal(await recoverConfigFromMarker(configPath, markerPath), true);
    assert.equal(await readFile(configPath, "utf8"), "original");
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