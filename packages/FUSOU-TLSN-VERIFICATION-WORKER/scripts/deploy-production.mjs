#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const inputManifestPath = resolve(packageDirectory, "scripts/production-inputs.json");
const deploymentAuthInputs = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "WRANGLER_SEND_METRICS",
  "WRANGLER_LOG",
];
const secretInputs = new Set([
  "TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER",
]);
const inheritedRuntimeInputs = [
  "PATH",
  "HOME",
  "PWD",
  "TMPDIR",
  "TMP",
  "TEMP",
  "CI",
  "NODE_OPTIONS",
  "XDG_CACHE_HOME",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "CC_wasm32_unknown_unknown",
  "AR_wasm32_unknown_unknown",
  "RUSTFLAGS",
];

function runGit(argumentsList) {
  const result = spawnSync("git", argumentsList, { cwd: packageDirectory, encoding: "utf8" });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim() || "git command failed");
  return result.stdout.trim();
}

function fail(message) {
  console.error(`[tlsn-deploy-production] ${message}`);
  process.exitCode = 1;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required deployment environment variable: ${name}`);
  return value;
}

async function main() {
  const manifest = JSON.parse(await readFile(inputManifestPath, "utf8"));
  const allowedInputs = manifest.allowed_inputs;
  if (
    manifest.schema_version !== 1 ||
    manifest.scope !== "fusou-tlsn-verification-worker-production" ||
    !Array.isArray(allowedInputs) ||
    allowedInputs.length === 0
  ) {
    throw new Error("production input manifest is invalid");
  }
  if (runGit(["status", "--porcelain=v1"])) throw new Error("refusing production deploy from a dirty git worktree");
  const gitCommitSha = runGit(["rev-parse", "HEAD"]);
  if (process.env.TLSN_GIT_COMMIT_SHA && process.env.TLSN_GIT_COMMIT_SHA !== gitCommitSha) {
    throw new Error("TLSN_GIT_COMMIT_SHA does not match the checked-out commit");
  }
  const deploymentEnvironment = {
    ...process.env,
    TLSN_DEPLOYMENT_ROLE: "production",
    TLSN_GIT_COMMIT_SHA: gitCommitSha,
  };
  const productionWorkerName = requiredEnvironment("TLSN_PRODUCTION_WORKER_NAME");
  if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(productionWorkerName)) {
    throw new Error("TLSN_PRODUCTION_WORKER_NAME must be a valid production Worker name");
  }
  if (process.env.TLSN_CANARY_BINDING_VALUE !== undefined) {
    throw new Error("TLSN_CANARY_BINDING_VALUE must not be present for production deployment");
  }
  requiredEnvironment("TLSN_CAPTURE_WORKER_URL");
  requiredEnvironment("TLSN_PREVIOUS_PROVENANCE_PATH");
  requiredEnvironment("TLSN_VERIFY_WORKER_URL");
  const remoteReportPath = requiredEnvironment("TLSN_REMOTE_REPORT_PATH");
  const productionOrigin = new URL(process.env.TLSN_VERIFY_WORKER_URL).origin;
  const captureOrigin = new URL(process.env.TLSN_CAPTURE_WORKER_URL).origin;
  const remoteOrigin = new URL(requiredEnvironment("TLSN_REMOTE_WORKER_URL")).origin;
  if (productionOrigin !== captureOrigin) {
    throw new Error("TLSN_CAPTURE_WORKER_URL and TLSN_VERIFY_WORKER_URL must target the same production Worker");
  }
  if (productionOrigin === remoteOrigin) {
    throw new Error("production and remote canary Worker URLs must be different");
  }
  deploymentEnvironment.TLSN_REMOTE_VALIDATION_REPORT_PATH = remoteReportPath;
  const deploymentInputs = new Set([
    ...allowedInputs,
    ...inheritedRuntimeInputs,
    "TLSN_PREFLIGHT_REPORT_PATH",
    "TLSN_PROVENANCE_REPORT_PATH",
  ]);
  const deploymentInputEnvironment = Object.fromEntries(
    Object.entries(deploymentEnvironment).filter(([name]) => deploymentInputs.has(name)),
  );
  const preflight = spawnSync("pnpm", ["run", "preflight:production"], {
    cwd: packageDirectory,
    env: deploymentInputEnvironment,
    stdio: "inherit",
  });
  if (preflight.error) throw preflight.error;
  if (preflight.status !== 0) {
    process.exitCode = preflight.status ?? 1;
    return;
  }

  const allowedChildEnvironment = new Set([
    ...allowedInputs,
    ...deploymentAuthInputs,
    ...inheritedRuntimeInputs,
  ]);
  const build = spawnSync("pnpm", ["run", "build:wasm"], {
    cwd: packageDirectory,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => inheritedRuntimeInputs.includes(name)),
    ),
    stdio: "inherit",
  });
  if (build.error) throw build.error;
  if (build.status !== 0) {
    process.exitCode = build.status ?? 1;
    return;
  }
  await rm(remoteReportPath, { force: true });
  const captureEnvironment = Object.fromEntries(
    Object.entries(deploymentEnvironment).filter(([name]) => (
      inheritedRuntimeInputs.includes(name) ||
      name === "TLSN_CAPTURE_WORKER_URL" ||
      name === "TLSN_PREVIOUS_PROVENANCE_PATH"
    )),
  );
  const capture = spawnSync(process.execPath, ["scripts/capture-deployment.mjs"], {
    cwd: packageDirectory,
    env: captureEnvironment,
    stdio: "inherit",
  });
  if (capture.error) throw capture.error;
  if (capture.status !== 0) {
    process.exitCode = capture.status ?? 1;
    return;
  }
  const remoteValidationEnvironment = Object.fromEntries(
    Object.entries(deploymentEnvironment).filter(([name]) => (
      inheritedRuntimeInputs.includes(name) ||
      name.startsWith("TLSN_REMOTE_")
    )),
  );
  remoteValidationEnvironment.TLSN_REMOTE_ALLOW_DECLARED_BLOCKED = "true";
  const remoteValidation = spawnSync("pnpm", ["run", "validate:remote"], {
    cwd: packageDirectory,
    env: remoteValidationEnvironment,
    stdio: "inherit",
  });
  if (remoteValidation.error) throw remoteValidation.error;
  if (remoteValidation.status !== 0) {
    process.exitCode = remoteValidation.status ?? 1;
    return;
  }
  const remoteGate = spawnSync(process.execPath, ["scripts/verify-remote-gate.mjs"], {
    cwd: packageDirectory,
    env: {
      ...remoteValidationEnvironment,
      TLSN_PROVENANCE_REPORT_PATH: deploymentEnvironment.TLSN_PROVENANCE_REPORT_PATH,
    },
    stdio: "inherit",
  });
  if (remoteGate.error) throw remoteGate.error;
  if (remoteGate.status !== 0) {
    process.exitCode = remoteGate.status ?? 1;
    return;
  }
  const childEnvironment = Object.fromEntries(
    Object.entries(deploymentEnvironment).filter(([name]) => allowedChildEnvironment.has(name) && !secretInputs.has(name)),
  );
  const deployArguments = ["exec", "wrangler", "deploy", "--name", productionWorkerName];
  for (const name of allowedInputs) {
    if (!secretInputs.has(name)) {
      deployArguments.push("--var", `${name}:${deploymentEnvironment[name]}`);
    }
  }
  const secretDirectory = await mkdtemp(join(tmpdir(), "tlsn-production-secrets-"));
  const secretsPath = join(secretDirectory, "secrets.json");
  try {
    await writeFile(
      secretsPath,
      JSON.stringify(Object.fromEntries([...secretInputs].map((name) => [name, deploymentEnvironment[name]]))),
      { encoding: "utf8", mode: 0o600 },
    );
    deployArguments.push("--secrets-file", secretsPath);
    const deploy = spawnSync("pnpm", deployArguments, {
      cwd: packageDirectory,
      env: childEnvironment,
      stdio: "inherit",
    });
    if (deploy.error) throw deploy.error;
    if (deploy.status !== 0) {
      process.exitCode = deploy.status ?? 1;
      return;
    }
    const verificationEnvironment = Object.fromEntries(
      Object.entries(deploymentEnvironment).filter(([name]) => (
        inheritedRuntimeInputs.includes(name) ||
        name === "TLSN_VERIFY_WORKER_URL" ||
        name === "TLSN_PROVENANCE_REPORT_PATH"
      )),
    );
    const verification = spawnSync(process.execPath, ["scripts/verify-deployment.mjs"], {
      cwd: packageDirectory,
      env: verificationEnvironment,
      stdio: "inherit",
    });
    if (verification.error) throw verification.error;
    process.exitCode = verification.status ?? 1;
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
