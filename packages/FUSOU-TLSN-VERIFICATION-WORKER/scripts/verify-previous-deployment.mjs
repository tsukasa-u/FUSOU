#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { writeImmutableJson } from "./deployment-attestation.mjs";
import {
  PREVIOUS_IDENTITY_FIELDS,
  parseExpectedIdentityChanges,
} from "./previous-deployment-contract.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function expectedChanges() {
  const raw = optional("TLSN_EXPECTED_PREVIOUS_IDENTITY_CHANGES");
  return parseExpectedIdentityChanges(raw);
}

async function main() {
  const previous = JSON.parse(await readFile(required("TLSN_PREVIOUS_PROVENANCE_PATH"), "utf8"));
  const current = JSON.parse(await readFile(required("TLSN_PROVENANCE_REPORT_PATH"), "utf8"));
  if (
    previous?.schema_version !== 2 ||
    previous?.scope !== "previous-known-good-deployment" ||
    previous?.environment !== "production" ||
    previous?.deployment_role !== "production"
  ) throw new Error("invalid previous production provenance");
  if (
    current?.schema_version !== 2 ||
    current?.scope !== "tlsn-deployment-provenance" ||
    current?.status !== "PASS" ||
    current?.environment !== "production" ||
    current?.deployment_role !== "production"
  ) throw new Error("invalid current production provenance");

  for (const [field, identityName] of PREVIOUS_IDENTITY_FIELDS) {
    if (typeof previous[identityName]?.[field] !== "string" || typeof current[identityName]?.[field] !== "string") {
      throw new Error(`previous/current provenance is missing ${identityName}.${field}`);
    }
  }

  const expected = expectedChanges();
  const changed = [];
  const unchanged = [];
  for (const [field, identityName] of PREVIOUS_IDENTITY_FIELDS) {
    if (previous[identityName]?.[field] === current[identityName]?.[field]) unchanged.push(field);
    else changed.push(field);
  }
  const unexpected = changed.filter((field) => !expected.has(field));
  const report = {
    schema_version: 2,
    scope: "tlsn-previous-deployment-identity-check",
    status: unexpected.length === 0 ? "PASS" : "FAIL",
    generated_at: new Date().toISOString(),
    previous_deployment_id: previous.deployment_identity?.deployment_id ?? null,
    current_deployment_id: current.deployment_identity?.deployment_id ?? null,
    expected_change_fields: [...expected].sort(),
    observed_change_fields: changed.sort(),
    unchanged_fields: unchanged.sort(),
    unexpected_change_fields: unexpected.sort(),
  };
  await writeImmutableJson(required("TLSN_PREVIOUS_CHANGE_REPORT_PATH"), report);
  console.log(JSON.stringify(report));
  if (unexpected.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[tlsn-verify-previous-deployment] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});