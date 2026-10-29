import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function assertEntryExecutes(path) {
  const env = { ...process.env };
  delete env.COMPACTION_JOB_JSON;
  const result = spawnSync(process.execPath, [path], { env, encoding: "utf8", timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1, `Expected input validation, not silent success:\n${result.stderr}`);
  assert.match(result.stderr, /Missing required env: COMPACTION_JOB_JSON/);
}

test("normal compiled entry executes its input validation", () => {
  assertEntryExecutes(entry);
});
test("directory alias containing spaces executes the same CLI", () => {
  const directory = mkdtempSync(join(tmpdir(), "fusou-cli-secondary-"));
  const alias = join(directory, "entry alias with spaces");
  try {
    symlinkSync(dirname(entry), alias, process.platform === "win32" ? "junction" : "dir");
    assertEntryExecutes(join(alias, "index.js"));
  } finally {
    unlinkSync(alias);
    rmdirSync(directory);
  }
});
test("case-varied Windows entry executes", { skip: process.platform !== "win32" }, () => {
  assertEntryExecutes(resolve(entry).toLowerCase());
});
test("importing the job library with a non-file argument does not execute the CLI", () => {
  const env = { ...process.env };
  delete env.COMPACTION_JOB_JSON;
  const result = spawnSync(process.execPath, [
    "--input-type=module", "--eval",
    `await import(${JSON.stringify(pathToFileURL(entry).href)});`,
    "not-an-existing-entry.js",
  ], { env, encoding: "utf8", timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
