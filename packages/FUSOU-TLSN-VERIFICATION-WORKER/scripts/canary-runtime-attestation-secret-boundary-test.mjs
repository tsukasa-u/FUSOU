#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const privateKeyInput = "TLSN_CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8";
const deploySource = await readFile(resolve(packageDirectory, "scripts/deploy-canary.mjs"), "utf8");
const provisionSource = await readFile(resolve(packageDirectory, "scripts/provision-canary-material.mjs"), "utf8");
const readinessSource = await readFile(resolve(packageDirectory, "scripts/canary-readiness-test.mjs"), "utf8");

assert.match(deploySource, /name !== CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT/);
assert.match(deploySource, /if \(!secretInputs\.has\(name\)\)/);
assert.match(deploySource, /runtimeAttestationSigningPrivateKeyPkcs8: deploymentEnvironment\[CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT\]/);
assert.doesNotMatch(deploySource, new RegExp(`--var[^\\n]*${privateKeyInput}`));
assert.doesNotMatch(readinessSource, new RegExp(privateKeyInput));

assert.match(provisionSource, new RegExp(JSON.stringify(privateKeyInput)));
assert.match(provisionSource, /provider_ref: `deployment-secret\/\$\{inputName\}`/);
assert.doesNotMatch(provisionSource, new RegExp(`generatedEnv\\[[^\\]]*${privateKeyInput}`));
assert.doesNotMatch(provisionSource, new RegExp(`privateFiles[\\s\\S]{0,800}${privateKeyInput}`));
assert.match(provisionSource, /secret_values_in_manifest: false/);

console.log("[tlsn-canary-runtime-attestation-secret-boundary] private signer stays outside Worker secrets, --var, readiness output, and repository artifacts PASS");