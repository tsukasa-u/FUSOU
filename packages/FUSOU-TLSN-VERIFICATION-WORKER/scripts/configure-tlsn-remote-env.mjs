#!/usr/bin/env node

import { chmod, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const sourcePath = resolve(
  packageDirectory,
  process.env.TLSN_REMOTE_BENCHMARK_SOURCE_FILE ?? ".cache/tlsn-remote-test.env",
);
const targetPath = resolve(
  packageDirectory,
  process.env.TLSN_REMOTE_BENCHMARK_ENV_FILE ?? ".env",
);
const keysPath = resolve(repositoryDirectory, "packages/.env.keys");
const removeSource = process.argv.includes("--remove-source");

function parseEnv(content) {
  const entries = [];
  for (const [lineNumber, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      throw new Error(`invalid env line ${lineNumber + 1}`);
    }
    const name = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`invalid env name at line ${lineNumber + 1}`);
    }
    entries.push([name, value]);
  }
  return entries;
}

function encryptValue(name, value) {
  const result = spawnSync(
    "pnpm",
    ["exec", "dotenvx", "set", name, value, "-f", targetPath, "-fk", keysPath],
    {
      cwd: repositoryDirectory,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`dotenvx failed while encrypting ${name}`);
  }
}

async function main() {
  await stat(sourcePath);
  await stat(keysPath);
  const entries = parseEnv(await readFile(sourcePath, "utf8"));
  const names = new Set();
  for (const [name, value] of entries) {
    if (names.has(name)) throw new Error(`duplicate env name: ${name}`);
    names.add(name);
    encryptValue(name, value);
  }
  await chmod(targetPath, 0o600);
  await chmod(keysPath, 0o600);
  if (removeSource) await rm(sourcePath, { force: true });
  console.log(`[tlsn-remote-env] encrypted ${entries.length} variables into ${targetPath}`);
  if (removeSource) console.log(`[tlsn-remote-env] removed plaintext source ${sourcePath}`);
}

main().catch((error) => {
  console.error(`[tlsn-remote-env] ${error instanceof Error ? error.message : "configuration_failed"}`);
  process.exitCode = 2;
});
