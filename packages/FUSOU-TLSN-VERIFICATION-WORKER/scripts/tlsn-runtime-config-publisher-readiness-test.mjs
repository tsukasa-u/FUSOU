#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getTlsnRuntimeConfigPublisherReadiness,
} from "./tlsn-runtime-config-publisher-readiness.mjs";
import { RUNTIME_CONFIG_R2_ENV } from "./tlsn-runtime-config-r2-store.mjs";

test("publisher readiness is a no-network diagnostic and never promotes unregistered Production trust", () => {
  const readiness = getTlsnRuntimeConfigPublisherReadiness({});
  assert.equal(readiness.readiness, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(readiness.production_publish_allowed, false);
  assert.equal(readiness.network_access_performed, false);
  assert.equal(readiness.signing_performed, false);
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "APP bootstrap signer root registration" && state === "NOT_REGISTERED"));
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "Independent Production signer pin" && state === "NOT_REGISTERED"));
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "Production signer provider" && state === "NOT_CONFIGURED"));
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "Live R2 conditional create and pointer CAS" && state === "NOT_RUN"));
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "Server-side signed epoch monotonicity on the current manifest pointer" &&
    state === "IMPLEMENTED_WITH_CONDITIONAL_CAS"));
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "Independent recovery authority if the server manifest pointer is lost" &&
    state === "NOT_REGISTERED"));
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "R2 credentials have sufficient bucket-scoped permissions" && state === "NOT_CHECKED"));
});

test("publisher readiness reports configured variable names and statuses without printing values", () => {
  const env = {
    [RUNTIME_CONFIG_R2_ENV.accountId]: "0123456789abcdef0123456789abcdef",
    [RUNTIME_CONFIG_R2_ENV.bucket]: "tlsn-runtime-config-prod",
    [RUNTIME_CONFIG_R2_ENV.accessKeyId]: "do-not-print-access-key",
    [RUNTIME_CONFIG_R2_ENV.secretAccessKey]: "do-not-print-secret",
  };
  const readiness = getTlsnRuntimeConfigPublisherReadiness(env);
  const serialized = JSON.stringify(readiness);

  assert.equal(readiness.readiness, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(readiness.production_publish_allowed, false);
  assert(serialized.includes("PRESENT_FORMAT_VALID"));
  assert(serialized.includes("PRESENT_UNVERIFIED"));
  assert(!serialized.includes(env[RUNTIME_CONFIG_R2_ENV.accessKeyId]));
  assert(!serialized.includes(env[RUNTIME_CONFIG_R2_ENV.secretAccessKey]));
  assert(!serialized.includes(env[RUNTIME_CONFIG_R2_ENV.accountId]));
  assert(!serialized.includes(env[RUNTIME_CONFIG_R2_ENV.bucket]));
});

test("invalid R2 account identifiers are explicitly reported rather than normalized into readiness", () => {
  const readiness = getTlsnRuntimeConfigPublisherReadiness({
    [RUNTIME_CONFIG_R2_ENV.accountId]: "invalid",
  });
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "R2 account ID format" && state === "INVALID_FORMAT"));
  assert.equal(readiness.readiness, "BLOCKED_EXTERNAL_INPUTS");
});

test("invalid R2 bucket names are reported as invalid without attempting a connection", () => {
  const readiness = getTlsnRuntimeConfigPublisherReadiness({
    [RUNTIME_CONFIG_R2_ENV.bucket]: "bad/bucket",
  });
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "R2 bucket name format" && state === "INVALID_FORMAT"));
  assert.equal(readiness.network_access_performed, false);
});

test("configured values and local signing capability never promote Production publisher readiness", () => {
  const env = {
    [RUNTIME_CONFIG_R2_ENV.accountId]: "0123456789abcdef0123456789abcdef",
    [RUNTIME_CONFIG_R2_ENV.bucket]: "tlsn-runtime-config-test",
    [RUNTIME_CONFIG_R2_ENV.accessKeyId]: "access-key-value",
    [RUNTIME_CONFIG_R2_ENV.secretAccessKey]: "secret-key-value",
  };
  const readiness = getTlsnRuntimeConfigPublisherReadiness(env);
  assert.equal(readiness.readiness, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(readiness.production_publish_allowed, false);
  assert.equal(readiness.network_access_performed, false);
  assert.equal(readiness.signing_performed, false);
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "R2 configuration complete" && state === "PRESENT"));
  assert(readiness.checks.some(({ requirement, state }) =>
    requirement === "Production publish authorization" && state === "BLOCKED_EXTERNAL_INPUTS"));
  const output = JSON.stringify(readiness);
  assert(!output.includes(env[RUNTIME_CONFIG_R2_ENV.accessKeyId]));
  assert(!output.includes(env[RUNTIME_CONFIG_R2_ENV.secretAccessKey]));
  assert(!output.includes(env[RUNTIME_CONFIG_R2_ENV.accountId]));
  assert(!output.includes(env[RUNTIME_CONFIG_R2_ENV.bucket]));
});
