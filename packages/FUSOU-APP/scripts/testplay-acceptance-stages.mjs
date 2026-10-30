export function testplayAcceptanceStages() {
  return {
    assessment_scope: "SOURCE_CONTRACT_ONLY",
    gameplay_authorized: false,
    TLSN_PROTOCOL_TESTPLAY: {
      status: "BLOCKED_CODE",
      independent_app_entry_point: "NOT_IMPLEMENTED",
      requirements: [
        "actual_game_server_presentation",
        "notary_signature",
        "observed_canonical_dns_and_web_pki",
        "signed_result_and_exact_presentation_binding",
      ],
      current_path_dependencies: [
        "approved_runtime_config_target_and_result_keys",
        "device_proof_apis",
        "session_and_binding_authorities",
        "worker_raw_presentation_result_archive",
      ],
      not_implied: [
        "user_device_ownership",
        "complete_19_role_bundle",
        "production_delivery_or_execution_authority",
      ],
      real_evidence_verification: "NOT_CHECKED",
    },
    IDENTITY_BOUND_TESTPLAY: {
      status: "BLOCKED_CODE",
      requirements: [
        "TLSN_PROTOCOL_TESTPLAY",
        "authenticated_user_and_owned_non_revoked_device",
        "device_proof_session_possession_consume_and_replay",
        "all_19_roles_and_independent_local_verification",
      ],
      code_blockers: [
        "owner_device_proof_handlers_missing",
        "real_material_collection_not_connected",
        "candidate_execution_receipt_gate_retained",
      ],
      full_bundle_remote_delivery_required_by_local_verifier: false,
      real_evidence_verification: "NOT_CHECKED",
    },
    PRODUCTION_EVIDENCE_DELIVERY: {
      status: "BLOCKED_CODE",
      requirements: [
        "IDENTITY_BOUND_TESTPLAY",
        "complete_bundle_remote_readback_and_retention",
        "independently_verified_delivery_receipt",
        "approved_execution_signer_trusted_builder_and_provider",
        "production_operational_acceptance",
      ],
      code_blockers: [
        "full_bundle_remote_delivery_not_implemented",
        "production_receipt_authority_contract_missing",
      ],
      production_acceptance: "BLOCKED",
      deployment: "NOT_CHECKED",
    },
  };
}
