#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { unstable_dev } from "wrangler";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const proxyManifest = resolve(
  repositoryDirectory,
  "packages/FUSOU-PROXY/proxy-https/Cargo.toml",
);
const repositoryNodeModules = resolve(packageDirectory, "../../node_modules/.bin");
const typescript = resolve(
  repositoryNodeModules,
  process.platform === "win32" ? "tsc.cmd" : "tsc",
);

function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, {
    cwd: packageDirectory,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, argumentsList, cwd) {
  const result = spawnSync(command, argumentsList, {
    cwd,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  const outputLines = result.stdout.trim().split(/\r?\n/);
  return JSON.parse(outputLines.at(-1));
}

run(process.execPath, ["scripts/build-wasm.mjs"]);
run(typescript, ["--noEmit", "--pretty", "false"]);

const syntheticFixture = capture(
  "cargo",
  [
    "+1.95.0",
    "run",
    "--quiet",
    "--manifest-path",
    proxyManifest,
    "--features",
    "synthetic-tlsn",
    "--example",
    "synthetic_tlsn_fixture",
  ],
  repositoryDirectory,
);

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const worker = await unstable_dev(resolve(packageDirectory, "src/index.ts"), {
  config: resolve(packageDirectory, "wrangler.toml"),
  vars: {
    TLSN_SERVER_IDENTITY: "game.example.test",
    TLSN_PROFILE_SHA256: Buffer.alloc(32).toString("base64url"),
    TLSN_VERIFIER_KEY_ID: "worker-test",
    TLSN_NOTARY_KEY_ID: "notary-test",
    TLSN_SIGNING_PRIVATE_KEY_PKCS8: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    TLSN_TRUST_ROOT_CERTIFICATE_DER: syntheticFixture.root_certificate_base64,
  },
  bundle: true,
  local: true,
  compatibilityDate: "2026-07-29",
  experimental: {
    disableExperimentalWarning: true,
    forceLocal: true,
    testMode: true,
  },
});

try {
  const { runSmokeTest } = await import("../test/index-smoke.mjs");
  await runSmokeTest(
    worker.fetch,
    syntheticFixture,
    publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  );
} finally {
  await worker.stop();
}

const mismatchedIdentityWorker = await unstable_dev(resolve(packageDirectory, "src/index.ts"), {
  config: resolve(packageDirectory, "wrangler.toml"),
  vars: {
    TLSN_SERVER_IDENTITY: "other.example.test",
    TLSN_PROFILE_SHA256: Buffer.alloc(32).toString("base64url"),
    TLSN_VERIFIER_KEY_ID: "worker-test",
    TLSN_NOTARY_KEY_ID: "notary-test",
    TLSN_SIGNING_PRIVATE_KEY_PKCS8: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    TLSN_TRUST_ROOT_CERTIFICATE_DER: syntheticFixture.root_certificate_base64,
  },
  bundle: true,
  local: true,
  compatibilityDate: "2026-07-29",
  experimental: {
    disableExperimentalWarning: true,
    forceLocal: true,
    testMode: true,
  },
});

try {
  const { runMismatchedIdentitySmokeTest } = await import("../test/index-smoke.mjs");
  await runMismatchedIdentitySmokeTest(mismatchedIdentityWorker.fetch, syntheticFixture);
} finally {
  await mismatchedIdentityWorker.stop();
}

const unconfiguredWorker = await unstable_dev(resolve(packageDirectory, "src/index.ts"), {
  config: resolve(packageDirectory, "wrangler.toml"),
  bundle: true,
  local: true,
  compatibilityDate: "2026-07-29",
  experimental: {
    disableExperimentalWarning: true,
    forceLocal: true,
    testMode: true,
  },
});

try {
  const { runUnconfiguredSmokeTest } = await import("../test/index-smoke.mjs");
  await runUnconfiguredSmokeTest(unconfiguredWorker.fetch);
} finally {
  await unconfiguredWorker.stop();
}