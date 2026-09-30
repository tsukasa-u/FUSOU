import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  prepareCaptureOutput,
  resolveCaptureOutputPath,
  restoreConfig,
  withCaptureConfig,
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
  assert.match(updated, /^deny_auth = true$/m);
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
  assert.match(updated, /^artifact_output_path = "\/tmp\/private-candidate\/tlsn"$/m);
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