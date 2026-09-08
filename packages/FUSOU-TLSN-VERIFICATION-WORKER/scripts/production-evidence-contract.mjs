export const PRODUCTION_EVIDENCE_SCOPE = "tlsn-production-evidence";
export const PRODUCTION_EVIDENCE_REQUIREMENTS = [
  "real_production_game_server_connection",
  "real_production_tlsn_notary_interaction",
  "real_production_fusou_web_device_authentication",
  "real_production_device_possession_proof",
  "real_production_replay_authority",
  "real_production_binding_authority",
  "real_production_verifier_trust_root",
  "real_production_result_signing_key",
  "real_production_public_key_publication",
  "independently_captured_production_evidence",
];

export function blockedProductionEvidenceContract() {
  return {
    scope: PRODUCTION_EVIDENCE_SCOPE,
    status: "BLOCKED",
    independent_capture_required: true,
    requirements: Object.fromEntries(
      PRODUCTION_EVIDENCE_REQUIREMENTS.map((requirement) => [requirement, "UNVERIFIED"]),
    ),
  };
}

export function assertProductionEvidenceBlocked(report) {
  if (report?.production_evidence !== "BLOCKED" || report?.p0_05 !== "BLOCKED") {
    throw new Error("production evidence and P0-05 must remain BLOCKED");
  }
  const contract = report?.production_evidence_contract;
  if (
    contract?.scope !== PRODUCTION_EVIDENCE_SCOPE ||
    contract?.status !== "BLOCKED" ||
    contract?.independent_capture_required !== true
  ) {
    throw new Error("production evidence contract is missing or not blocked");
  }
  for (const requirement of PRODUCTION_EVIDENCE_REQUIREMENTS) {
    if (contract.requirements?.[requirement] !== "UNVERIFIED") {
      throw new Error(`production evidence requirement is not unverified: ${requirement}`);
    }
  }
}