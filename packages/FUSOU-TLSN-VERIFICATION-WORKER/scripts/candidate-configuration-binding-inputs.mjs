import { readFile } from "node:fs/promises";
import { loadTlsnCandidateBundle } from "./tlsn-candidate-finalize.mjs";
import { candidateConfigurationBindingAssessment } from "./candidate-configuration-binding.mjs";

export const CANDIDATE_CONFIGURATION_BINDING_INPUT_PATHS = Object.freeze({
  candidate_artifact_bundle: "TLSN_CANDIDATE_ARTIFACT_BUNDLE_PATH",
  approved_expected_configuration_fingerprint: "TLSN_APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT_PATH",
  current_binary_identity: "TLSN_CURRENT_BINARY_IDENTITY_PATH",
  trusted_builder_provenance: "TLSN_TRUSTED_BUILDER_PROVENANCE_PATH",
  independent_authority_receipt: "TLSN_INDEPENDENT_AUTHORITY_RECEIPT_PATH",
  configuration_approval_trust_bundle: "TLSN_CONFIGURATION_APPROVAL_AUTHORITY_TRUST_BUNDLE_PATH",
  trusted_builder_trust_bundle: "TLSN_TRUSTED_BUILDER_AUTHORITY_TRUST_BUNDLE_PATH",
  independent_candidate_authority_trust_bundle: "TLSN_INDEPENDENT_CANDIDATE_AUTHORITY_TRUST_BUNDLE_PATH",
});

async function readJsonEvidence(environment, inputName) {
  const filePath = environment[inputName]?.trim();
  if (!filePath) return { status: "MISSING", value: null };
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    return { status: "PRESENT", value };
  } catch {
    return { status: "INVALID", value: {} };
  }
}

export async function assessCandidateConfigurationBindingInputs({
  environment = process.env,
  expectedSourceCommit = null,
  expectedDeploymentIdentity = null,
  authenticatedCurrentDeploymentIdentity = null,
  trustedAuthorityTrustRoots = {},
  now = new Date(),
} = {}) {
  const candidatePath = environment[CANDIDATE_CONFIGURATION_BINDING_INPUT_PATHS.candidate_artifact_bundle]?.trim();
  let candidateArtifactIdentity = null;
  let candidateBundleStatus = "MISSING";
  let syntheticFixture = false;
  if (candidatePath) {
    try {
      const bundle = await loadTlsnCandidateBundle(candidatePath);
      candidateArtifactIdentity = bundle.candidateArtifactIdentity;
      syntheticFixture = bundle.manifest.synthetic_fixture;
      candidateBundleStatus = syntheticFixture
        ? "PASS_SYNTHETIC_LOCAL_CONSISTENCY"
        : "PASS_LOCAL_CONSISTENCY";
    } catch {
      candidateBundleStatus = "INVALID";
    }
  }

  const evidenceInputs = Object.fromEntries(await Promise.all(
    Object.entries(CANDIDATE_CONFIGURATION_BINDING_INPUT_PATHS)
      .filter(([name]) => name !== "candidate_artifact_bundle")
      .map(async ([name, inputName]) => [name, await readJsonEvidence(environment, inputName)]),
  ));
  const assessment = candidateConfigurationBindingAssessment({
    candidateArtifactIdentity,
    candidateBundleStatus,
    syntheticFixture,
    approvedExpectedConfigurationFingerprint: evidenceInputs.approved_expected_configuration_fingerprint.value,
    currentBinaryIdentity: evidenceInputs.current_binary_identity.value,
    trustedBuilderProvenance: evidenceInputs.trusted_builder_provenance.value,
    independentAuthorityReceipt: evidenceInputs.independent_authority_receipt.value,
    authorityTrustBundles: {
      CONFIGURATION_APPROVAL: evidenceInputs.configuration_approval_trust_bundle.value,
      TRUSTED_BUILDER: evidenceInputs.trusted_builder_trust_bundle.value,
      INDEPENDENT_CANDIDATE_AUTHORITY: evidenceInputs.independent_candidate_authority_trust_bundle.value,
    },
    trustedAuthorityTrustRoots,
    expectedSourceCommit,
    expectedDeploymentIdentity,
    authenticatedCurrentDeploymentIdentity,
    now,
  });
  return Object.freeze({
    ...assessment,
    input_sources: Object.freeze({
      candidate_artifact_bundle: candidateBundleStatus,
      ...Object.fromEntries(Object.entries(evidenceInputs).map(([name, input]) => [name, input.status])),
    }),
  });
}