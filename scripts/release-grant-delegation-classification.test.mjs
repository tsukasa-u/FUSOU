import assert from "node:assert/strict";
import { test } from "node:test";
import { readRegularFile } from "./release-files.mjs";
import { readDelegationBootstrapSources, inspectDelegationBootstrap } from "./release-grant-delegation.mjs";
import { classifyDelegationBootstrap, DELEGATION_DATA_CLASSES } from "./release-grant-delegation-classification.mjs";

const sources = await readDelegationBootstrapSources();
const inspect = (policy = structuredClone(sources.policy)) => inspectDelegationBootstrap({ ...sources, policy });
const runtimeNames = ["source_sha", "workflow_sha", "run_id", "run_attempt", "release_input_sha256",
  "capture_id", "session_id", "job_id", "verification_attempt_id", "binding_id", "object_version", "raw_sha256", "expires_at_ms"];

test("all 43 fields and all 22 legacy gaps have exactly one primary classification", () => {
  const report = inspect(), inventory = report.classification;
  assert.equal(inventory.status, "SOURCE_CONTRACT_READY");
  assert.deepEqual(inventory.errors, []);
  assert.deepEqual(inventory.fields.map((field) => field.field).sort(), [...sources.schema.required].sort());
  assert.equal(new Set(inventory.fields.map((field) => field.field)).size, 43);
  assert.deepEqual(inventory.legacy_missing_fields.map((field) => field.field).sort(), [...report.external_inputs.missing].sort());
  assert.equal(inventory.legacy_missing_fields.length, 22);
  assert.deepEqual(inventory.counts, {
    ONE_TIME_BOOTSTRAP_INPUT: 3, SOURCE_DERIVED: 18, RUNTIME_DERIVED: 0, AUTHORITY_STATE_DERIVED: 0,
    EXTERNAL_REGISTRATION_REQUIRED: 0, UNDEFINED_CONTRACT: 19, DIAGNOSTIC_ONLY: 3,
  });
  assert.equal(inventory.legacy_missing_fields.filter((field) => field.data_class === "ONE_TIME_BOOTSTRAP_INPUT").length, 3);
  assert.equal(inventory.legacy_missing_fields.filter((field) => field.data_class === "UNDEFINED_CONTRACT").length, 19);
});
test("every inventory row includes current state, provenance, independent verification and all requested flags", () => {
  for (const field of inspect().classification.fields) {
    assert(DELEGATION_DATA_CLASSES.includes(field.data_class));
    assert.equal(field.schema_path, `#/properties/${field.field}`);
    for (const key of ["current_value", "current_state", "normal_source", "independent_verification", "blocker",
      "one_time_bootstrap_requirement", "runtime_derivation", "source_auto_derivable", "approval_requirement",
      "registration_requirement", "approval_actor", "registration_target", "registration_state", "basis"]) {
      assert(Object.hasOwn(field, key), `${field.field}:${key}`);
    }
    assert(field.normal_source.length > 0 && field.independent_verification.length > 0);
    assert(field.basis.length > 0);
    assert.equal(field.registration_state, "NOT_VERIFIED");
    assert.equal(field.current_value, sources.policy[field.field]);
  }
});
test("minimal draft separates three known static selections from 19 unresolved contracts, not a complete minimum", () => {
  const report = inspect(), manifest = report.classification.minimal_manifest;
  assert.deepEqual(manifest.static_trust_inputs.map((field) => field.field), [
    "repository_id", "repository_owner_id", "delegate_revision",
  ]);
  assert.equal(manifest.undefined_contracts.length, 19);
  assert.equal(manifest.complete_minimum_established, false);
  assert.equal(manifest.completeness, "UNDEFINED_CONTRACT");
  assert.equal(manifest.lifecycle, "PROPOSED");
  assert.equal(manifest.operational_enabled, false);
  assert.equal(manifest.publication_authorized, false);
  for (const field of manifest.static_trust_inputs) {
    assert.equal(field.current_value, null);
    assert.equal(field.current_state, "NOT_VERIFIED");
    assert.equal(field.source_auto_derivable, false);
    assert.match(field.approval_actor, /UNDEFINED_CONTRACT_U02/);
    assert.match(field.registration_target, /PROTOCOL_NOT_IMPLEMENTED/);
  }
});
test("source-derived rule labels have existing explicit sources and are not independently registered values", async () => {
  const allowed = new Set([
    "docs/architecture/adr-tlsn-grant-authority-delegation.md",
    "scripts/tlsn-grant-delegation.v1.schema.json", "scripts/release-eligibility.mjs",
    "scripts/release-grant-provider.mjs", "scripts/release-execution-intake.mjs", "scripts/release-archive-provenance.mjs",
    ".github/workflows/tlsn-grant-delegation.yml",
    "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs",
    "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs",
    "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs",
    "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts",
  ]);
  const classification = inspect().classification;
  const bases = [...classification.fields, ...classification.minimal_manifest.derivations,
    ...classification.minimal_manifest.protocol_requirements].flatMap((record) => record.basis);
  for (const basis of bases) assert(allowed.has(basis.path), `source outside explicit allowlist: ${basis.path}`);
  const texts = new Map(await Promise.all([...new Set(bases.map((basis) => basis.path))].map(async (path) => [
    path, (await readRegularFile(new URL(`../${path}`, import.meta.url))).toString("utf8"),
  ])));
  for (const basis of bases) assert(texts.get(basis.path).includes(basis.anchor), `${basis.path}:${basis.anchor}`);
  for (const field of classification.fields.filter((field) => field.source_auto_derivable)) {
    assert.equal(field.data_class, "SOURCE_DERIVED");
    assert(Object.hasOwn(sources.schema.properties[field.field], "const"));
    assert.equal(field.current_value, sources.schema.properties[field.field].const);
    assert.equal(field.registration_requirement, "POLICY_BUNDLE_NOT_SEPARATE_VALUE");
    assert.equal(field.approval_requirement, "POLICY_BUNDLE_REQUIRED");
  }
});
test("runtime and authority observations remain separate, unobserved, and not new schema requirements", () => {
  const manifest = inspect().classification.minimal_manifest;
  for (const field of runtimeNames) {
    assert(!Object.hasOwn(sources.schema.properties, field));
    assert(!manifest.static_trust_inputs.some((input) => input.field === field));
  }
  assert.equal(sources.schema.required.length, 43);
  assert.equal(manifest.derivations.length, 5);
  for (const derivation of manifest.derivations) {
    assert(["RUNTIME_DERIVED", "AUTHORITY_STATE_DERIVED"].includes(derivation.data_class));
    assert.equal(derivation.current_values, null);
    assert.equal(derivation.observation, "NOT_OBSERVED");
    assert.equal(derivation.grant_binding, "NOT_IMPLEMENTED");
    assert(derivation.verification.length > 0);
  }
  assert.match(manifest.derivations.find((item) => item.name === "release_and_capture_policy_inputs").verification,
    /UNDEFINED_CONTRACT; do not drop pins/);
  assert.match(manifest.derivations.find((item) => item.name === "consumed_capture_lookup").verification,
    /selector is still undefined/);
});
test("unresolved wire, identity, lifetime, capture and CAS semantics are not registration-only settings", () => {
  const manifest = inspect().classification.minimal_manifest;
  for (const name of ["authority_endpoint", "authority_deployment_identity", "authority_state_epoch", "issue_audience",
    "read_audience", "policy_digest_contract", "active_policy_registry_identity", "public_input_derivation_contract",
    "capture_selection_contract", "grant_issuer_identity", "grant_wire_contract", "grant_scope_contract", "grant_ttl_ms",
    "revocation_contract", "state_revision_cas_contract", "consumer_read_endpoint", "consumer_identity_contract"]) {
    const field = manifest.undefined_contracts.find((field) => field.field === name);
    assert(field, name);
    assert.equal(field.data_class, "UNDEFINED_CONTRACT");
    assert.equal(field.source_auto_derivable, false);
    assert.equal(field.one_time_bootstrap_requirement, "UNDEFINED_CONTRACT");
    assert.equal(field.registration_requirement, "UNDEFINED_CONTRACT");
    assert.equal(field.current_value, null);
  }
  for (const protocol of manifest.protocol_requirements) {
    assert.equal(protocol.design_status, "UNDEFINED_CONTRACT");
    assert.equal(protocol.implementation_status, "NOT_IMPLEMENTED");
    assert(protocol.known.length > 0 && protocol.missing.length > 0);
  }
});
test("filled local values and ACTIVE or PASS claims never change categories, registration or full readiness", () => {
  const policy = structuredClone(sources.policy);
  for (const [field, rule] of Object.entries(sources.schema.properties)) {
    if (!rule["x-bootstrap-input"]) continue;
    policy[field] = field === "delegate_revision" ? "c".repeat(40) :
      ["repository_id", "repository_owner_id"].includes(field) ? "7" :
      field.endsWith("_endpoint") ? `https://synthetic.invalid/${field}` :
      field === "grant_ttl_ms" ? 60000 : `synthetic:${field}`;
  }
  policy.lifecycle = "ACTIVE";
  for (const input of [policy, { ...policy, status: "PASS", authenticated: true }]) {
    const before = structuredClone(input), report = inspect(input);
    assert.equal(report.readiness.complete, false);
    assert.equal(report.bootstrap_inputs.verification, "NOT_VERIFIED");
    assert.equal(report.bootstrap_inputs.complete_minimum_established, false);
    assert.equal(report.external_registration.status, "NOT_VERIFIED");
    assert.equal(report.policy_approval.status, "BLOCKED_POLICY_NOT_APPROVED");
    assert.equal(report.classification.minimal_manifest.lifecycle, "PROPOSED");
    assert.equal(report.publication_authorized, false);
    assert.equal(report.runtime_authorization_enabled, false);
    assert.equal(report.classification.counts.UNDEFINED_CONTRACT, 19);
    assert.equal(report.classification.minimal_manifest.external_registration.status, "NOT_VERIFIED");
    assert.deepEqual(input, before);
  }
});
test("incomplete or duplicated classification coverage cannot be marked source ready", () => {
  for (const missing of [[], ["repository_id"], [...inspect().external_inputs.missing, "repository_id"], ["unclassified"]]) {
    const result = classifyDelegationBootstrap({ ...sources, missing });
    assert.equal(result.status, "BLOCKED_IMPLEMENTATION");
    assert(result.errors.some((error) => error.code === "CLASSIFICATION_MISSING_INPUT_COVERAGE_MISMATCH"));
  }
  const schema = structuredClone(sources.schema); delete schema.properties.repository_id;
  assert.equal(classifyDelegationBootstrap({ policy: sources.policy, schema }).status, "BLOCKED_IMPLEMENTATION");
});
test("invalid proposed values are explicit and not echoed as valid source or bootstrap observations", () => {
  const policy = structuredClone(sources.policy); policy.authority_endpoint = "https://user:password@synthetic.invalid/";
  const report = inspect(policy), field = report.classification.fields.find((item) => item.field === "authority_endpoint");
  assert.equal(report.source_contract.status, "BLOCKED_IMPLEMENTATION");
  assert.equal(field.current_state, "INVALID_NOT_ECHOED");
  assert.equal(field.current_value, null);
  assert.equal(report.readiness.complete, false);
});
test("OIDC subject configuration and actual reusable claim availability remain explicitly unverified", async () => {
  const oidc = inspect().classification.minimal_manifest.oidc;
  assert.equal(oidc.sub_format, "NOT_ASSUMED");
  assert.equal(oidc.current_official_specification, "NOT_CHECKED_OFFLINE");
  assert.equal(oidc.repository_subject_settings, "NOT_VERIFIED");
  assert.equal(oidc.immutable_subject_configuration, "NOT_VERIFIED");
  assert.equal(oidc.job_workflow_claim_semantics_and_availability, "NOT_VERIFIED");
  assert.equal(oidc.eligibility_observation_to_authority, "UNDEFINED_CONTRACT");
  assert.equal(oidc.owner_claim_enforcement, "SOURCE_IMPLEMENTED_NOT_EXTERNALLY_OBSERVED");
  const verifier = (await readRegularFile(new URL(
    "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs", import.meta.url))).toString("utf8");
  assert.doesNotMatch(verifier, /payload\.sub|subject:/);
  assert.match(verifier, /"repository_owner_id"/);
  assert.match(verifier, /assertVerifiedArchiveOidcClaims\(payload, policy, nowMs\)/);
  assert.match(verifier, /policy\.job_workflow_ref === undefined/);
});
test("caller mutation of a diagnostic projection cannot mutate future classification or protocol facts", () => {
  const original = inspect(), changed = inspect();
  changed.classification.fields[0].basis[0].path = "untrusted";
  changed.classification.minimal_manifest.static_trust_inputs[0].data_class = "SOURCE_DERIVED";
  changed.classification.minimal_manifest.protocol_requirements[0].implementation_status = "IMPLEMENTED";
  changed.classification.minimal_manifest.implementation_requirements.push("untrusted");
  assert.deepEqual(inspect(), original);
});
