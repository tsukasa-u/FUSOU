import path from "node:path";
import {
  assertBuildReference,
  assertCompiledReport,
  sha256,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs";
import {
  appConfigurationProjectionSha256,
  verifyAppConfigurationFingerprint,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/candidate-artifact-identity.mjs";

const digestPattern = /^[A-Za-z0-9_-]{43}$/;

function parseReference(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("approved Worker reference is malformed JSON");
  }
}

function assertAppPreflight(report, { configPath, buildProfile, reference }) {
  if (!report || typeof report !== "object" || Array.isArray(report) ||
      report.feature_enabled !== true || report.ready !== true ||
      report.config_path !== configPath || report.build_profile !== buildProfile ||
      !Array.isArray(report.checks) || report.checks.length === 0) {
    throw new Error("actual APP binary did not pass the candidate pre-capture preflight");
  }

  const checks = new Map();
  for (const check of report.checks) {
    if (!check || typeof check.name !== "string" || !check.name ||
        !["pass", "warning", "error"].includes(check.status) ||
        typeof check.detail !== "string" || checks.has(check.name)) {
      throw new Error("actual APP binary returned an invalid pre-capture check inventory");
    }
    checks.set(check.name, check);
  }
  for (const name of [
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
  ]) {
    if (checks.get(name)?.status !== "pass") {
      throw new Error(`actual APP pre-capture preflight did not pass required check ${name}`);
    }
  }
  if (report.checks.some((check) => check?.status === "error")) {
    throw new Error("actual APP binary reported a failed pre-capture check");
  }
  const disclosureMode = checks.get("tlsn_disclosure_mode").detail;
  const responseMode = checks.get("tlsn_response_mode").detail;
  if (disclosureMode !== reference.disclosure_mode || !["async", "sync"].includes(responseMode)) {
    throw new Error("actual APP preflight disclosure/response mode does not match the candidate contract");
  }
  const fingerprints = verifyAppConfigurationFingerprint(report.public_configuration_fingerprints);
  const pins = reference.compile_inputs;
  const compileTimeSha256 = appConfigurationProjectionSha256("compile_time", {
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
  });
  const runtimeSha256 = appConfigurationProjectionSha256("runtime", {
    experiment_enabled: true,
    candidate_capture_enabled: true,
    disclosure_mode: disclosureMode,
    response_mode: responseMode,
  });
  if (fingerprints.compile_time_sha256 !== compileTimeSha256 ||
      fingerprints.runtime_sha256 !== runtimeSha256) {
    throw new Error("actual APP configuration fingerprints do not match the approved candidate inputs");
  }
}

export function createPreCaptureReadiness({
  workerReferenceBytes,
  expectedReferenceSha256,
  expectedWorkerSha,
  expectedAppSha,
  buildProfile,
  configPath,
  appBuildRecord,
  appPreflightReport,
  createdAt = new Date().toISOString(),
}) {
  if (!Buffer.isBuffer(workerReferenceBytes) ||
      sha256(workerReferenceBytes) !== expectedReferenceSha256) {
    throw new Error("approved Worker reference bytes do not match the independent SHA-256 pin");
  }
  if (!digestPattern.test(expectedReferenceSha256 ?? "") ||
      !/^[0-9a-f]{40}$/.test(expectedWorkerSha ?? "") ||
      !/^[0-9a-f]{40}$/.test(expectedAppSha ?? "") ||
      !["debug", "release"].includes(buildProfile) ||
      typeof configPath !== "string" || !path.isAbsolute(configPath) ||
      !Number.isFinite(Date.parse(createdAt))) {
    throw new Error("pre-capture readiness inputs are incomplete or invalid");
  }

  const reference = assertBuildReference(
    parseReference(workerReferenceBytes),
    expectedWorkerSha,
  );
  if (!appBuildRecord || appBuildRecord.schema_version !== 3 ||
      appBuildRecord.scope !== "fusou-tlsn-app-operator-build-record" ||
      appBuildRecord.authority_status !== "UNVERIFIED" ||
      appBuildRecord.compiled_input_comparison !== "VERIFIED" ||
      appBuildRecord.runtime_config_bootstrap_comparison !== "VERIFIED" ||
      appBuildRecord.public_app_configuration_comparison !== "VERIFIED" ||
      appBuildRecord.reference_sha256 !== expectedReferenceSha256 ||
      appBuildRecord.worker_source_sha !== expectedWorkerSha ||
      appBuildRecord.app_source_sha !== expectedAppSha ||
      appBuildRecord.active_version_id !== reference.cloudflare.version_id ||
      appBuildRecord.disclosure_mode !== reference.disclosure_mode ||
      appBuildRecord.entry_input_sha256 !== appBuildRecord.compiled_report?.entry_input_sha256 ||
      appBuildRecord.build_profile !== buildProfile ||
      appBuildRecord.runtime_config_bootstrap?.registration_status !== "EMBEDDED_UNVERIFIED" ||
      !digestPattern.test(appBuildRecord.artifact?.sha256 ?? "") ||
      !Number.isSafeInteger(appBuildRecord.artifact?.byte_length) ||
      appBuildRecord.artifact.byte_length <= 0) {
    throw new Error("APP build record does not match the approved Worker reference");
  }
  assertCompiledReport(
    appBuildRecord.compiled_report,
    reference,
    expectedAppSha,
    buildProfile,
    appBuildRecord.runtime_config_bootstrap,
  );
  assertAppPreflight(appPreflightReport, { configPath, buildProfile, reference });

  return {
    schema_version: 2,
    scope: "fusou-tlsn-testplay-pre-capture-readiness",
    created_at: createdAt,
    status: "LOCAL_APP_PREFLIGHT_PASS",
    authority_status: "UNVERIFIED",
    gameplay_authorized: false,
    production_acceptance: "BLOCKED",
    worker_reference_sha256: expectedReferenceSha256,
    worker_source_sha: expectedWorkerSha,
    active_version_id: reference.cloudflare.version_id,
    app_source_sha: expectedAppSha,
    app_build_profile: buildProfile,
    app_binary_sha256: appBuildRecord.artifact.sha256,
    app_public_configuration_fingerprints:
      appPreflightReport.public_configuration_fingerprints,
    runtime_config_bootstrap: appBuildRecord.runtime_config_bootstrap,
    app_preflight_checks: appPreflightReport.checks,
    gates: {
      approved_worker_reference: "VERIFIED",
      active_version_endpoint_and_authority_pins: "VERIFIED",
      app_compile_input_handoff: "VERIFIED",
      compiled_app_binary_report: "VERIFIED",
      runtime_config_bootstrap: "EMBEDDED_UNVERIFIED",
      local_tlsn_preflight: "VERIFIED",
      transport_lifecycle_policy: "EXPLICIT_LOCAL_LIMITS",
      notary_attestation_limit: "EXPLICIT_LOCAL_LIMIT",
      service_connectivity: "NOT_CHECKED",
      evidence_delivery: "POST_CAPTURE_REQUIRED",
      independent_evidence_verification: "POST_CAPTURE_REQUIRED",
      auth_and_registered_device: "REQUIRES_APP_RUNTIME",
      human_gameplay_approval: "REQUIRES_HUMAN_OPERATOR",
      target_identity: "NOT_YET_OBSERVED",
      runtime_target_approval: "REQUIRES_APP_RUNTIME",
      target_approval: "POST_CAPTURE_REQUIRED",
      gameplay_authorization: "NOT_GRANTED",
      production_acceptance: "BLOCKED",
    },
    target_identity: {
      status: "NOT_YET_OBSERVED",
      server_identity: null,
    },
  };
}
