#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCanaryExternalPackage,
  CANARY_EXTERNAL_PACKAGE_ARTIFACTS,
  CANARY_EXTERNAL_PACKAGE_INPUTS,
} from "./canary-external-package.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";

const currentHead = "a".repeat(40);
const now = new Date("2026-01-01T00:00:00.000Z");
const environment = {
  TLSN_CANDIDATE_SERVER_IDENTITY: "canary.example.com",
  TLSN_ENVIRONMENT: "production",
  TLSN_DEPLOYMENT_ROLE: "canary",
  TLSN_REPOSITORY: "owner/repository",
  TLSN_GIT_COMMIT_SHA: currentHead,
  TLSN_WORKFLOW_RUN_ID: "12345",
  TLSN_WORKFLOW_RUN_ATTEMPT: "2",
  TLSN_WORKFLOW_FILE_IDENTITY: "dotenvx+pnpm+wrangler",
  TLSN_CANARY_BINDING_IDENTITY: "canary-binding-authority",
  TLSN_CANDIDATE_PROFILE_SHA256: "complete-profile-hash",
  TLSN_CANDIDATE_SPARSE_PROFILE_SHA256: "sparse-profile-hash",
  TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON: JSON.stringify({ scope: "approved", schema_version: 1 }),
  TLSN_PRODUCTION_NOTARY_REGISTRY: JSON.stringify({ keys: ["notary-key"] }),
  TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER: Buffer.from("trust-root").toString("base64url"),
};

for (const [index, name] of CANARY_EXTERNAL_PACKAGE_INPUTS.entries()) {
  if (environment[name] === undefined) environment[name] = `${name.toLowerCase()}-${index}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function inputFingerprint(name) {
  const raw = environment[name].trim();
  const bytes = name === "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON"
    ? canonicalJson(JSON.parse(raw))
    : name === "TLSN_PRODUCTION_NOTARY_REGISTRY"
      ? canonicalJson(JSON.parse(raw))
      : name === "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER"
        ? Buffer.from(raw, "base64url")
        : raw;
  return sha256(bytes);
}

async function createManifest(packageRoot) {
  const artifacts = [];
  await mkdir(join(packageRoot, "artifacts"));
  for (const name of CANARY_EXTERNAL_PACKAGE_ARTIFACTS) {
    const path = `artifacts/${name}.json`;
    const bytes = Buffer.from(`current-${name}`, "utf8");
    await writeFile(join(packageRoot, path), bytes);
    artifacts.push({
      name,
      path,
      sha256: sha256(bytes),
      current: true,
      fixture_only: false,
      historical: false,
    });
  }
  return {
    schema_version: 1,
    scope: "tlsn-canary-external-input-package",
    package_id: "approval-package-2026-01-01",
    issued_at: "2025-12-31T00:00:00.000Z",
    expires_at: "2026-01-02T00:00:00.000Z",
    target: {
      server_identity: "canary.example.com",
      environment: "production",
      deployment_role: "canary",
      binding_identity: "canary-binding-authority",
    },
    workflow: {
      repository: "owner/repository",
      run_id: "12345",
      run_attempt: "2",
      workflow_file_identity: "dotenvx+pnpm+wrangler",
      commit_sha: currentHead,
    },
    inputs: CANARY_EXTERNAL_PACKAGE_INPUTS.map((name) => ({
      name,
      value_sha256: inputFingerprint(name),
      approval_reference: `approval/${name.toLowerCase()}`,
      provenance_reference: `provenance/${name.toLowerCase()}`,
      evidence_level: "AUTHORITY_SIGNED",
    })),
    artifacts,
    secret_provider: {
      access_token: {
        input_name: "TLSN_REMOTE_ACCESS_TOKEN_A",
        provider_ref: "secret-provider/user-a/access-token",
        issued_at: "2025-12-31T00:00:00.000Z",
        expires_at: "2026-01-01T01:00:00.000Z",
      },
      private_key: {
        selected_input_name: "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
        provider_ref: "secret-provider/user-a/device-key-b64url",
        issued_at: "2025-12-31T00:00:00.000Z",
        expires_at: "2026-01-01T01:00:00.000Z",
      },
    },
  };
}

const packageRoot = await mkdtemp(join(tmpdir(), "tlsn-canary-package-"));
try {
  const manifest = await createManifest(packageRoot);
  assert.equal(
    (await assertCanaryExternalPackage(manifest, { packageRoot, environment, currentHead, now })).scope,
    "tlsn-canary-external-input-package",
  );

  const tamperedArtifact = structuredClone(manifest);
  tamperedArtifact.artifacts[0].sha256 = sha256("tampered");
  await assert.rejects(
    () => assertCanaryExternalPackage(tamperedArtifact, { packageRoot, environment, currentHead, now }),
    /artifact hash does not match manifest/,
  );

  const wrongTarget = structuredClone(manifest);
  wrongTarget.target.server_identity = "other.example.com";
  await assert.rejects(
    () => assertCanaryExternalPackage(wrongTarget, { packageRoot, environment, currentHead, now }),
    /target identity does not match/,
  );

  const secretValue = structuredClone(manifest);
  secretValue.secret_provider.access_token.access_token_value = "secret-marker";
  await assert.rejects(
    () => assertCanaryExternalPackage(secretValue, { packageRoot, environment, currentHead, now }),
    /secret value field/,
  );

  const bothPrivateKeys = structuredClone(manifest);
  const bothPrivateKeyEnvironment = {
    ...environment,
    TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL: "selected-marker",
    TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE: "other-marker",
  };
  await assert.rejects(
    () => assertCanaryExternalPackage(bothPrivateKeys, {
      packageRoot,
      environment: bothPrivateKeyEnvironment,
      currentHead,
      now,
    }),
    /both remote private key representations are present/,
  );
} finally {
  await rm(packageRoot, { recursive: true, force: true });
}

console.log("[tlsn-canary-external-package] manifest, artifact, identity, secret-boundary, and one-of contract PASS");