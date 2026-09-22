#!/usr/bin/env node

import assert from "node:assert/strict";
import { inspectCanaryExternalInput } from "./canary-external-input-dry-run.mjs";

const secretMarker = "dry-run-secret-marker-must-not-appear";
const report = await inspectCanaryExternalInput({
  TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8: secretMarker,
  TLSN_REMOTE_ACCESS_TOKEN_A: secretMarker,
  TLSN_CANARY_UNEXPECTED_INPUT: "unexpected",
});
const serialized = JSON.stringify(report);

assert.equal(report.network_access, "NOT_USED");
assert.equal(report.runtime_executed, false);
assert.equal(report.deployment_executed, false);
assert.equal(report.validation, "FAIL");
assert.ok(report.missing_required_inputs.length > 0);
assert.equal(report.ownership_summary.contract_entry_count, 68);
assert.equal(report.ownership_summary.missing_contract_entry_count, report.missing_required_inputs.length);
assert.ok(report.ownership_summary.external_dependency_missing_count > 0);
assert.equal(report.ownership_summary.unmet_external_required_group_count, 0);
assert.ok(report.ownership_summary.locally_generable_missing_count > 0);
assert.ok(report.ownership_summary.missing_contract_entry_count > report.ownership_summary.external_dependency_missing_count);
assert.deepEqual(report.unexpected_input_names, ["TLSN_CANARY_UNEXPECTED_INPUT"]);
assert.equal(report.inputs.find((entry) => entry.name === "TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8").status, "PRESENT");
assert.equal(report.inputs.find((entry) => entry.name === "TLSN_REMOTE_ACCESS_TOKEN_A").phase, "REMOTE_VALIDATION_ONLY");
assert.doesNotMatch(serialized, new RegExp(secretMarker));

console.log("[tlsn-canary-input-dry-run] presence, format, phase, unexpected-input, and secret-redaction contract PASS");
