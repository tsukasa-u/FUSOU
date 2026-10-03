const CANDIDATE_CONFIGURATION_BINDING_ASSESSMENT = Object.freeze({
  status: "UNVERIFIED",
  stages: Object.freeze({
    candidate_fingerprint_present: "NOT_EVALUATED",
    candidate_artifact_cryptographically_bound: "NOT_EVALUATED",
    approved_expected_fingerprint_match: "BLOCKED_MISSING_INPUT",
    binary_provenance_authenticated: "BLOCKED_NO_TRUSTED_BUILDER",
    independent_authority_provenance_verified: "BLOCKED_MISSING_AUTHORITY",
  }),
  missing_inputs: Object.freeze([
    "CANDIDATE_ARTIFACT_BUNDLE",
    "APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT",
    "AUTHENTICATED_BUILDER_PROVENANCE",
    "INDEPENDENT_AUTHORITY_RECEIPT",
  ]),
  readiness_effect: "NONE",
  gameplay_effect: "NONE",
});

export function candidateConfigurationBindingAssessment() {
  return {
    ...CANDIDATE_CONFIGURATION_BINDING_ASSESSMENT,
    stages: { ...CANDIDATE_CONFIGURATION_BINDING_ASSESSMENT.stages },
    missing_inputs: [...CANDIDATE_CONFIGURATION_BINDING_ASSESSMENT.missing_inputs],
  };
}