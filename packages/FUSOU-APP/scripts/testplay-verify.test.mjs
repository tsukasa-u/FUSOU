import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { restoreConfig, withCaptureConfig } from "./testplay-verify.mjs";

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