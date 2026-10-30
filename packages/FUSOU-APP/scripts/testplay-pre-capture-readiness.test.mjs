import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCompiledReport,
  entryInputSha256,
  runtimeConfigBootstrapInputs,
  runtimeConfigBootstrapReport,
  sha256,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs";
import {
  account,
  controls,
  customMapping,
  environment,
  manifest,
  now,
  provenance,
  release,
  version1,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-worker-reference-fixture.mjs";
import { approvedProductionRelease, createAppWorkerReference } from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-worker-deployment-reference.mjs";
import { createPreCaptureReadiness } from "./testplay-pre-capture-readiness.mjs";
import {
  appConfigurationProjectionSha256,
  recomputeAppConfigurationCombinedSha256,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/candidate-artifact-identity.mjs";

const expectedWorkerSha = "a".repeat(40);
const expectedAppSha = "b".repeat(40);
const buildProfile = "debug";
const configPath = "/tmp/fusou-testplay-config.toml";
const bootstrapEnvironment = {
  FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL: "https://runtime-config.example.org/tlsn/runtime-config/v2/manifest.json",
  FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID: "runtime-config-test-key",
  FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI:
    Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.alloc(32, 7)]).toString("base64url"),
};
const bootstrapReport = runtimeConfigBootstrapReport(runtimeConfigBootstrapInputs(bootstrapEnvironment));
const requiredPreflightCheckNames = [
  "compile_time_feature",
  "build_profile",
  "config_source",
  "tlsn_enabled",
  "tlsn_runtime_config_bootstrap",
  "tlsn_transport_lifecycle_policy",
  "tlsn_notary_attestation_limit",
  "tlsn_notary_endpoint",
  "tlsn_session_authority_endpoint",
  "tlsn_verification_endpoint",
  "tlsn_worker_health_endpoint",
  "tlsn_expected_worker_identity",
  "tlsn_expected_active_version_id",
  "tlsn_worker_endpoint_binding",
  "tlsn_disclosure_mode",
  "tlsn_response_mode",
  "tlsn_session_authority_key_id",
  "tlsn_session_authority_public_key",
  "tlsn_result_signer_key_id",
  "tlsn_result_public_key_spki",
  "tlsn_result_signing_key_registry",
  "tlsn_notary_verifying_key",
  "tlsn_platform_trust_store",
  "tlsn_candidate_capture_enabled",
  "tlsn_origin_inventory",
  "tlsn_artifact_output_path",
];

function reference(disclosureMode = release.disclosureMode) {
  const selectedRelease = approvedProductionRelease(
    { ...environment, TLSN_PRODUCTION_DISCLOSURE_MODE: disclosureMode },
    provenance,
    manifest,
  );
  const observed = controls(selectedRelease, version1);
  return createAppWorkerReference(
    selectedRelease,
    observed.deployment,
    observed.version,
    account,
    now,
    customMapping(selectedRelease),
  );
}

function inputs(disclosureMode = "complete", responseMode = "async") {
  const workerReference = reference(disclosureMode);
  const workerReferenceBytes = Buffer.from(`${JSON.stringify(workerReference)}\n`);
  const expectedReferenceSha256 = sha256(workerReferenceBytes);
  const pins = workerReference.compile_inputs;
  const compileTimeProjection = {
    expected_deployment_id: pins.FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID,
    expected_worker_name: pins.FUSOU_TLSN_EXPECTED_WORKER_NAME,
    expected_git_commit_sha: pins.FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA,
    expected_binding_mode: pins.FUSOU_TLSN_EXPECTED_BINDING_MODE,
    worker_health_endpoint: pins.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT,
    verification_endpoint: pins.FUSOU_TLSN_VERIFICATION_ENDPOINT,
    notary_endpoint: pins.FUSOU_TLSN_NOTARY_ENDPOINT,
    notary_verifying_key: pins.FUSOU_TLSN_NOTARY_VERIFYING_KEY,
    session_authority_endpoint: pins.FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT,
    session_authority_key_id: pins.FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID,
    session_authority_public_key: pins.FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY,
    result_public_key_spki: pins.FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI,
    result_signer_key_id: pins.FUSOU_TLSN_RESULT_SIGNER_KEY_ID,
    result_signing_key_registry: pins.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY,
  };
  const fingerprints = {
    schema_version: 2,
    scope: "fusou-tlsn-app-public-configuration",
    compile_time_sha256: appConfigurationProjectionSha256("compile_time", compileTimeProjection),
    runtime_sha256: appConfigurationProjectionSha256("runtime", {
      experiment_enabled: true,
      candidate_capture_enabled: true,
      disclosure_mode: workerReference.disclosure_mode,
      response_mode: responseMode,
    }),
    candidate_binding_status: "UNBOUND",
  };
  fingerprints.combined_sha256 = recomputeAppConfigurationCombinedSha256(fingerprints);
  const compiledReport = {
    schema_version: 2,
    scope: "fusou-tlsn-app-compiled-worker-entry-report",
    entry_input_sha256: entryInputSha256(workerReference.compile_inputs),
    worker_source_sha: expectedWorkerSha,
    active_version_id: version1,
    app_source_sha: expectedAppSha,
    build_profile: buildProfile,
    tlsn_production_feature: true,
    custom_protocol_feature: true,
    runtime_config_bootstrap: bootstrapReport,
    authority_status: "UNVERIFIED",
  };
  const appBuildRecord = {
    schema_version: 3,
    scope: "fusou-tlsn-app-operator-build-record",
    authority_status: "UNVERIFIED",
    compiled_input_comparison: "VERIFIED",
    runtime_config_bootstrap_comparison: "VERIFIED",
    public_app_configuration_comparison: "VERIFIED",
    reference_sha256: expectedReferenceSha256,
    worker_source_sha: expectedWorkerSha,
    app_source_sha: expectedAppSha,
    active_version_id: version1,
    disclosure_mode: workerReference.disclosure_mode,
    entry_input_sha256: compiledReport.entry_input_sha256,
    runtime_config_bootstrap: bootstrapReport,
    build_profile: buildProfile,
    artifact: { sha256: "c".repeat(43), byte_length: 128 },
    compiled_report: compiledReport,
  };
  assertCompiledReport(compiledReport, workerReference, expectedAppSha, buildProfile, bootstrapReport);
  const appPreflightReport = {
    feature_enabled: true,
    build_profile: buildProfile,
    config_path: configPath,
    public_configuration_fingerprints: fingerprints,
    ready: true,
    checks: requiredPreflightCheckNames.map((name) => ({
      name,
      status: "pass",
      detail: name === "tlsn_response_mode" ? responseMode
        : name === "tlsn_disclosure_mode" ? workerReference.disclosure_mode : "fixture check",
    })),
  };

  return {
    workerReferenceBytes,
    expectedReferenceSha256,
    expectedWorkerSha,
    expectedAppSha,
    buildProfile,
    configPath,
    appBuildRecord,
    appPreflightReport,
  };
}

for (const mode of ["complete", "sparse"]) {
  for (const response of ["async", "sync"]) {
    test(`${mode}/${response}: pre-capture gate binds the reference and APP reports without granting gameplay`, () => {
      const readiness = createPreCaptureReadiness(inputs(mode, response));

      assert.equal(readiness.schema_version, 2);
      assert.equal(readiness.status, "LOCAL_APP_PREFLIGHT_PASS");
      assert.equal(readiness.active_version_id, version1);
      assert.equal(readiness.authority_status, "UNVERIFIED");
      assert.equal(readiness.gameplay_authorized, false);
      assert.equal(readiness.production_acceptance, "BLOCKED");
      assert.equal(readiness.acceptance_stages.assessment_scope, "SOURCE_CONTRACT_ONLY");
      assert.equal(readiness.acceptance_stages.gameplay_authorized, false);
      for (const stage of ["TLSN_PROTOCOL_TESTPLAY", "IDENTITY_BOUND_TESTPLAY", "PRODUCTION_EVIDENCE_DELIVERY"]) {
        assert.equal(readiness.acceptance_stages[stage].status, "BLOCKED_CODE");
      }
      assert.equal(readiness.runtime_config_bootstrap.registration_status, "EMBEDDED_UNVERIFIED");
      assert.deepEqual(readiness.target_identity, {
        status: "NOT_YET_OBSERVED",
        server_identity: null,
      });
      assert.equal(readiness.gates.runtime_target_approval, "REQUIRES_APP_RUNTIME");
      assert.equal(readiness.gates.transport_lifecycle_policy, "EXPLICIT_LOCAL_LIMITS");
      assert.equal(readiness.gates.notary_attestation_limit, "EXPLICIT_LOCAL_LIMIT");
      assert.equal(readiness.gates.service_connectivity, "NOT_CHECKED");
      assert.equal(readiness.gates.evidence_delivery, "POST_CAPTURE_REQUIRED");
      assert.equal(readiness.gates.independent_evidence_verification, "POST_CAPTURE_REQUIRED");
      assert.equal(readiness.gates.target_approval, "POST_CAPTURE_REQUIRED");
      assert.equal(readiness.gates.auth_and_registered_device, "REQUIRES_APP_RUNTIME");
      assert.equal(readiness.gates.human_gameplay_approval, "REQUIRES_HUMAN_OPERATOR");
    });
  }
}

test("pre-capture gate rejects a changed reference byte or independent digest", () => {
  const values = inputs();
  values.workerReferenceBytes = Buffer.from(`${values.workerReferenceBytes.toString()} `);
  assert.throws(() => createPreCaptureReadiness(values), /independent SHA-256 pin/);

  const changedPin = inputs();
  changedPin.expectedReferenceSha256 = "z".repeat(43);
  assert.throws(() => createPreCaptureReadiness(changedPin), /independent SHA-256 pin/);
});

test("pre-capture gate rejects Worker version, endpoint, or authority pin mismatch", () => {
  for (const mutate of [
    (reference) => { reference.cloudflare.version_id = "5b064508-1cdb-453c-826b-bdea36a8b1e5"; },
    (reference) => { reference.compile_inputs.FUSOU_TLSN_VERIFICATION_ENDPOINT = "https://other.example.com/verify/tlsn"; },
    (reference) => { reference.cloudflare.checked_public_bindings.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID = "unapproved"; },
  ]) {
    const values = inputs();
    const changed = reference();
    mutate(changed);
    values.workerReferenceBytes = Buffer.from(`${JSON.stringify(changed)}\n`);
    values.expectedReferenceSha256 = sha256(values.workerReferenceBytes);
    assert.throws(() => createPreCaptureReadiness(values), /reference|pins|mapping|binding/i);
  }
});

test("pre-capture gate rejects compiled binary and local APP preflight mismatches", () => {
  const badBinary = inputs();
  badBinary.appBuildRecord.compiled_report.active_version_id =
    "5b064508-1cdb-453c-826b-bdea36a8b1e5";
  assert.throws(() => createPreCaptureReadiness(badBinary), /actual APP binary/);

  const badPreflight = inputs();
  badPreflight.appPreflightReport.checks.find(
    (check) => check.name === "tlsn_origin_inventory",
  ).status = "error";
  badPreflight.appPreflightReport.ready = false;
  assert.throws(() => createPreCaptureReadiness(badPreflight), /pre-capture preflight/);
});

test("pre-capture gate refuses a target outside the shipped inventory check", () => {
  const badTargetSet = inputs();
  badTargetSet.appPreflightReport.checks.find(
    (check) => check.name === "tlsn_origin_inventory",
  ).status = "warning";
  assert.throws(() => createPreCaptureReadiness(badTargetSet), /tlsn_origin_inventory/);
});

test("pre-capture gate rejects an incomplete APP preflight check inventory", () => {
  const missingCheck = inputs();
  missingCheck.appPreflightReport.checks = missingCheck.appPreflightReport.checks.filter(
    (check) => check.name !== "tlsn_result_signing_key_registry",
  );
  assert.throws(
    () => createPreCaptureReadiness(missingCheck),
    /did not pass required check tlsn_result_signing_key_registry/,
  );
});

test("pre-capture gate blocks an APP preflight without a valid embedded Runtime Config bootstrap", () => {
  const values = inputs();
  values.appPreflightReport.checks.find(
    (check) => check.name === "tlsn_runtime_config_bootstrap",
  ).status = "error";
  values.appPreflightReport.ready = false;
  assert.throws(() => createPreCaptureReadiness(values), /did not pass the candidate pre-capture preflight/);
  values.appPreflightReport.ready = true;
  assert.throws(() => createPreCaptureReadiness(values), /tlsn_runtime_config_bootstrap/);
});

test("pre-capture gate rejects inconsistent or unrelated APP configuration fingerprints", () => {
  for (const mutate of [
    (fingerprints) => { fingerprints.combined_sha256 = sha256("another combined fingerprint"); },
    (fingerprints) => {
      fingerprints.compile_time_sha256 = sha256("another build's public configuration");
      fingerprints.combined_sha256 = recomputeAppConfigurationCombinedSha256(fingerprints);
    },
    (fingerprints) => {
      fingerprints.runtime_sha256 = appConfigurationProjectionSha256("runtime", {
        experiment_enabled: false, candidate_capture_enabled: true,
        disclosure_mode: "complete", response_mode: "async",
      });
      fingerprints.combined_sha256 = recomputeAppConfigurationCombinedSha256(fingerprints);
    },
  ]) {
    const values = inputs();
    mutate(values.appPreflightReport.public_configuration_fingerprints);
    assert.throws(() => createPreCaptureReadiness(values), /fingerprint/i);
  }
});

test("pre-capture gate rejects disclosure disagreement and missing, duplicate, warning, or error checks", () => {
  const wrongMode = inputs();
  wrongMode.appPreflightReport.checks.find(
    (check) => check.name === "tlsn_disclosure_mode",
  ).detail = "sparse";
  assert.throws(() => createPreCaptureReadiness(wrongMode), /disclosure/i);
  for (const name of requiredPreflightCheckNames) {
    for (const operation of ["missing", "duplicate", "warning", "error"]) {
      const values = inputs();
      const checks = values.appPreflightReport.checks;
      const check = checks.find((entry) => entry.name === name);
      if (operation === "missing") values.appPreflightReport.checks = checks.filter((entry) => entry !== check);
      else if (operation === "duplicate") checks.push({ ...check });
      else check.status = operation;
      assert.throws(() => createPreCaptureReadiness(values), /pre-capture|preflight/i);
    }
  }
});
