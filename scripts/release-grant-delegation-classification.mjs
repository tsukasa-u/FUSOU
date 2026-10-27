export const DELEGATION_DATA_CLASSES = Object.freeze([
  "ONE_TIME_BOOTSTRAP_INPUT", "SOURCE_DERIVED", "RUNTIME_DERIVED", "AUTHORITY_STATE_DERIVED",
  "EXTERNAL_REGISTRATION_REQUIRED", "UNDEFINED_CONTRACT", "DIAGNOSTIC_ONLY",
]);

const adr = "docs/architecture/adr-tlsn-grant-authority-delegation.md";
const schemaPath = "scripts/tlsn-grant-delegation.v1.schema.json";
const evidence = {
  schema: { path: schemaPath, anchor: '"properties"' },
  issuer: { path: "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs", anchor: "GITHUB_OIDC_ISSUER" },
  jwks: { path: "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs", anchor: "GITHUB_OIDC_JWKS" },
  caller: { path: "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs", anchor: "ARCHIVE_WORKFLOW_REF" },
  workflow: { path: ".github/workflows/tlsn-grant-delegation.yml", anchor: "if: ${{ false }}" },
  eligibility: { path: "scripts/release-eligibility.mjs", anchor: "evaluateReleaseRun" },
  candidate: { path: "scripts/release-grant-provider.mjs", anchor: "deriveArchiveGrant" },
  intake: { path: "scripts/release-execution-intake.mjs", anchor: "EXECUTION_IMPLEMENTATION_PATHS" },
  provenance: { path: "scripts/release-archive-provenance.mjs", anchor: "reauthenticateSavedArchive" },
  catalog: { path: "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs", anchor: "readAuthorityArchiveCatalog" },
  authority: { path: "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts", anchor: "getConsumedVerificationResult" },
};
const row = (id) => ({ path: adr, anchor: `| ${id} |` });
const source = (origin, decision, meaning) => ({
  data_class: "SOURCE_DERIVED", basis: [evidence[origin], row(decision)], meaning,
  normal_source: "Fixed schema constant or source-defined rule label; reproduce from the inspected immutable source.",
  independent_verification: "Compare with schema const and cited source/ADR under the independently approved implementation revision; source presence is not delegation approval.",
  blocker: "SOURCE_OR_APPROVED_POLICY_BINDING_NOT_VERIFIED",
});
const undefinedContract = (decision, meaning) => ({
  data_class: "UNDEFINED_CONTRACT", basis: [row(decision)], meaning,
  normal_source: `Independent protocol/policy decision ${decision}; no currently approved value-supply interface.`,
  independent_verification: "Define and approve semantics, authentication and acquisition before implementing independent authority/consumer verification. A nonempty local string is insufficient.",
  blocker: `${decision}_UNDEFINED_CONTRACT`,
});
const staticInput = (origin, decision, meaning, verification) => ({
  data_class: "ONE_TIME_BOOTSTRAP_INPUT", basis: [evidence[origin], row(decision)], meaning,
  normal_source: "Independently authenticated repository identity or explicitly approved immutable delegate selection; never producer output.",
  independent_verification: verification, blocker: "INDEPENDENT_BOOTSTRAP_INPUT_NOT_VERIFIED",
});
const diagnostic = (meaning) => ({
  data_class: "DIAGNOSTIC_ONLY", basis: [evidence.schema], meaning,
  normal_source: "Local nonoperational planning record.",
  independent_verification: "Validate shape only; this field cannot establish approval, registration or authorization.",
  blocker: "NO_AUTHORIZATION_CAPABILITY",
});

const fields = {
  schema_version: source("schema", "U02", "Version of this planning format, not an issued-grant schema."),
  scope: source("schema", "U02", "Bootstrap planning namespace, not per-grant authorization scope."),
  lifecycle: diagnostic("Local PROPOSED/ACTIVE/REVOKED claim; no authenticated active-state evidence."),
  operational_enabled: diagnostic("Always false in this source-only planning contract."),
  publication_authorized: diagnostic("Always false; no publication capability."),
  issuer: source("issuer", "P02", "Existing fixed GitHub issuer; reuse does not approve delegation."),
  jwks_uri: source("jwks", "P02", "Existing fixed issuer JWKS source, not a caller/header-selected key URL."),
  issue_audience: undefinedContract("U06", "Purpose separation is proposed; exact issuance endpoint/audience semantics are not defined."),
  read_audience: undefinedContract("U06", "Independent read purpose is required; exact reader audience semantics are undefined."),
  repository: source("caller", "P04", "Known repository name is descriptive, not a replacement for numeric repository/owner pins."),
  repository_id: staticInput("candidate", "P04", "Stable numeric repository identity, not a per-run ID.",
    "After external access is allowed, compare authenticated GitHub repository metadata and signed repository_id with independently registered authority/consumer policy."),
  repository_owner_id: staticInput("issuer", "P04", "Stable ownership pin; archive verification requires a canonical string and strict signed-claim equality.",
    "After external access is allowed, independently observe repository owner ID and actual signed claim, then compare approved policy. Claim checking is source-implemented; real registration and signed identity acceptance remain NOT_VERIFIED."),
  caller_workflow: source("caller", "P05", "Existing caller path; its mutable ref alone cannot authenticate a trusted revision."),
  caller_revision_policy: source("schema", "P06", "Source rule label only; actual caller workflow SHA is independently observed each run."),
  delegate_workflow: source("workflow", "P05", "Fixed-disabled diagnostic path, not an approved issuer."),
  delegate_revision: staticInput("workflow", "P06", "One approved immutable delegate revision/closure per controlled rotation, not each release source SHA.",
    "Select and independently approve the final issuer implementation/closure; resolve its full Git SHA and compare signed job_workflow_ref/job_workflow_sha. Current diagnostic HEAD is not an issuer pin."),
  delegate_claims_contract: source("schema", "U01", "Proposed mandatory signed reusable claims; actual availability/semantics NOT_VERIFIED."),
  event: source("caller", "P07", "Current caller event label; actual reusable signed event semantics remain unobserved."),
  ref: source("caller", "P07", "Current main caller ref; not a substitute for run/revision/eligibility checks."),
  eligibility_contract: source("eligibility", "P07", "Existing Production eligibility algorithm label, not an authenticated issuance observation."),
  workflow_source_rule: source("schema", "P08", "Source/caller/delegate identities have distinct roles; their SHA values are not required to differ."),
  authority_endpoint: undefinedContract("U06", "Grant issuance route/method/role contract is absent; the existing archive-readback URL is not an issuer endpoint."),
  authority_deployment_identity: undefinedContract("U05", "Authenticated issuer/deployment/routing identity is not defined by a Worker binding name."),
  authority_state_epoch: undefinedContract("U08", "Grant epoch ingestion, restore/rollback fencing and state semantics do not exist; do not generate an epoch."),
  policy_pin_source_contract: source("schema", "P11", "Independent authority/consumer distribution requirement; current input pins are not delegation roots."),
  policy_digest_contract: undefinedContract("U02", "Policy encoding/domain/distribution and authenticated expected digest are undefined; local hashing is not approval."),
  active_policy_registry_identity: undefinedContract("U02", "No approved active-root registry identity/distribution/rotation interface is defined."),
  public_input_derivation_contract: undefinedContract("U03", "Existing concrete per-release pins remain required; approved automatic expected-input derivation is absent."),
  capture_selection_contract: undefinedContract("U04", "Exact catalog state exists, but release-to-capture/subject authorization is undefined; source equality is insufficient."),
  capture_state_contract: source("catalog", "P09", "Requirement label; concrete catalog observations are authority-derived, not manual bootstrap values."),
  grant_issuer_identity: undefinedContract("U05", "Logical issuer/deployment/epoch binding is undefined; catalog writer names are not an authenticated global issuer."),
  grant_scope_contract: undefinedContract("U07", "Logical scope, grant ID/domain and exact scope-to-release/capture correlation are undefined."),
  grant_wire_contract: undefinedContract("U07", "Issued-grant schema/canonical raw bytes/digest/receipt representation are undefined."),
  grant_ttl_ms: undefinedContract("U09", "Issued-grant lifetime/freshness/time policy is not approved; candidate TTL must not be copied as issuer policy."),
  freshness_and_clock_contract: undefinedContract("U09", "Authorization freshness, clock uncertainty and reader final-recheck semantics need approval."),
  revocation_contract: undefinedContract("U08", "Revocation authority/propagation/terminal state/rollback handling are undefined."),
  state_revision_cas_contract: undefinedContract("U08", "Grant revision, atomic persistence, post-await revalidation and cross-object fencing are undefined."),
  external_io_contract: source("schema", "U08", "ADR requirement only: external I/O outside transactions and state/epoch revalidation; grant CAS is not implemented."),
  idempotence_contract: source("schema", "U08", "ADR requirement only: same logical scope/content retains ID/bytes/expiry; changed content conflicts; no global ledger."),
  consumer_read_endpoint: undefinedContract("U06", "Separate read-only grant protocol, not the existing raw archive-readback API."),
  consumer_identity_contract: undefinedContract("U10", "Independent cross-run reader identity/producer relation and non-enumerating lookup are undefined."),
  consumer_recheck_contract: source("provenance", "U10", "Existing report reacquisition is not grant verification; independent grant-state reacquisition remains unimplemented."),
  source_inventory_contract: undefinedContract("U12", "Existing EXECUTION_IMPLEMENTATION_PATHS is not the final issuer closure; delegation migration/inventory acceptance is undefined."),
};

const derivations = [
  {
    name: "producer_and_validation_context", data_class: "RUNTIME_DERIVED",
    values: ["producer_run_id", "producer_run_attempt", "caller_workflow_sha", "validation_run_id", "validation_run_attempt"],
    basis: [evidence.candidate, evidence.intake], verification: "Reacquire authenticated run/attempt/repository/workflow metadata; compare independent caller and validation contexts.",
    existing_contract: "CANDIDATE_AND_REPORT_ONLY", grant_binding: "NOT_IMPLEMENTED",
  },
  {
    name: "release_source", data_class: "RUNTIME_DERIVED", values: ["release_source_sha", "tag", "observed_main_sha"],
    basis: [evidence.eligibility], verification: "Live successful same-repository tag-validation push, tag resolution/recheck, main ancestry and workflow parity; development is not Production.",
    existing_contract: "CANDIDATE_AND_REPORT_ONLY", grant_binding: "NOT_IMPLEMENTED",
  },
  {
    name: "release_and_capture_policy_inputs", data_class: "RUNTIME_DERIVED",
    values: ["public_build_inputs_sha256", "check_policy_sha256", "capture_policy_sha256"],
    basis: [evidence.candidate, evidence.provenance, row("U03"), row("U04")],
    verification: "Compute exact input-byte digests and compare independent existing pins. Automatic expected-input and authorized-capture derivation are UNDEFINED_CONTRACT; do not drop pins.",
    existing_contract: "PARTIAL_EXISTING_PINNED_INPUT_CHECKS", grant_binding: "NOT_IMPLEMENTED",
  },
  {
    name: "consumed_capture_lookup", data_class: "AUTHORITY_STATE_DERIVED",
    values: ["capture_id", "session_id", "canonical_user_id", "device_id", "job_id", "verification_attempt_id", "binding_id"],
    basis: [evidence.catalog, evidence.authority, row("U04")],
    verification: "Exact consumed Result/receipt/binding/catalog with subject/job lookup. The authorized release-to-lookup selector is still undefined.",
    existing_contract: "EXACT_CONSUMED_CATALOG_ONLY", grant_binding: "NOT_IMPLEMENTED",
  },
  {
    name: "archive_observations", data_class: "AUTHORITY_STATE_DERIVED",
    values: ["object_key", "object_version", "raw_byte_length", "raw_sha256", "result_envelope_sha256", "optional_verifier_execution_receipt_sha256"],
    basis: [evidence.catalog, evidence.authority],
    verification: "Recompute catalog from exact persisted Result/optional receipt and snapshots; compare current R2 version/raw length/digest. No historical generation or retention guarantee.",
    existing_contract: "EXACT_CONSUMED_CATALOG_ONLY", grant_binding: "NOT_IMPLEMENTED",
  },
];

const protocols = [
  { name: "delegation_policy_authorization", decisions: ["U01", "U02"], known: "Identity is not step attestation; independently approved delegation is mandatory.", missing: "Approval principal, active-root authentication/distribution and delegated observation binding." },
  { name: "grant_issuer_identity", decisions: ["U05"], known: "Existing authority is proposed final issuer.", missing: "Authenticated logical issuer/deployment/epoch and routing/restore semantics." },
  { name: "grant_representation_and_scope", decisions: ["U07"], known: "Exact release/capture/Result/optional receipt bindings and immutable bytes are required.", missing: "Wire schema, ID/scope encoding, canonical bytes and digest domain." },
  { name: "authority_revision_and_cas", decisions: ["U08"], known: "External I/O outside transaction, revalidation after awaits, same-scope nonrenewing idempotence; no global ledger.", missing: "Grant persistence/CAS, policy epochs, cross-object coordination, rollback fencing." },
  { name: "expiry_and_revocation", decisions: ["U08", "U09"], known: "Expired/revoked/uncertain state must reject, not renew on retry.", missing: "Approved TTL/freshness/clocks and revocation authority/state propagation." },
  { name: "authority_reader", decisions: ["U06", "U10"], known: "Separate scoped read-only API; no arbitrary enumeration or candidate fallback.", missing: "Endpoint/audience/wire/roles and consistent grant bytes plus mutable state." },
  { name: "consumer_independent_verification", decisions: ["U10", "U11"], known: "Reader run is distinct from producer; independent live context and final grant/evidence recheck.", missing: "Authenticated cross-run reader relation and authority acquisition evidence." },
  { name: "eligibility_to_issuance", decisions: ["U01", "U03"], known: "evaluateReleaseRun exists; approved immutable delegate must perform its own checks.", missing: "Trusted issuer closure, signed reusable claim semantics and authenticated observation path to authority." },
  { name: "archive_to_grant_scope", decisions: ["U04", "U07"], known: "Consumed catalog independently supplies exact archive observations.", missing: "Authorized release-to-capture/subject predicate and its exact grant binding." },
  { name: "delegation_source_inventory", decisions: ["U12"], known: "Existing inventories constrain current implementation, not delegation approval.", missing: "Approved issuer/reader closure, migration and real acceptance." },
];
const implementationRequirements = [
  "SIGNED_REUSABLE_IDENTITY_AND_TRUSTED_CLOSURE_NOT_VERIFIED",
  "DELEGATION_POLICY_REGISTRY_ADAPTER_NOT_REGISTERED",
  "GRANT_AUTHORIZATION_API_NOT_REGISTERED",
  "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED",
  "ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED",
  "READ_ONLY_GRANT_READER_NOT_REGISTERED",
  "INDEPENDENT_RELEASE_INPUT_AND_CAPTURE_SELECTION_CONTRACT_UNDEFINED",
];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const scalar = (value) => value === null || typeof value === "string" || typeof value === "boolean" || Number.isSafeInteger(value);

export function classifyDelegationBootstrap({ policy, schema, errors = [], missing }) {
  const keys = record(schema?.properties) ? Object.keys(schema.properties) : [];
  const expectedMissing = keys.filter((key) => schema.properties[key]?.["x-bootstrap-input"] &&
    (!record(policy) || !Object.hasOwn(policy, key) || policy[key] === null || errors.some((error) => error.path === key)));
  const missingKeys = missing === undefined ? expectedMissing : missing;
  const coverageErrors = [];
  if (keys.length !== Object.keys(fields).length || keys.some((key) => !Object.hasOwn(fields, key))) {
    coverageErrors.push({ path: "$classification", code: "CLASSIFICATION_SCHEMA_COVERAGE_MISMATCH" });
  }
  if (!Array.isArray(missingKeys) || missingKeys.length !== expectedMissing.length ||
    new Set(missingKeys).size !== missingKeys.length ||
    missingKeys.some((key) => !Object.hasOwn(fields, key) || !expectedMissing.includes(key))) {
    coverageErrors.push({ path: "$classification", code: "CLASSIFICATION_MISSING_INPUT_COVERAGE_MISMATCH" });
  }
  const inventory = Object.entries(fields).map(([field, definition]) => {
    const present = record(policy) && Object.hasOwn(policy, field);
    const invalid = errors.some((error) => error.path === field) || present && !scalar(policy[field]);
    const value = present && !invalid ? policy[field] : null;
    const category = definition.data_class;
    return {
      field, schema_path: `#/properties/${field}`, current_value: value,
      current_state: invalid ? "INVALID_NOT_ECHOED" : !present ? "MISSING" : value === null ?
        category === "UNDEFINED_CONTRACT" ? "UNDEFINED_CONTRACT" : "NOT_VERIFIED" :
        category === "SOURCE_DERIVED" ? "SOURCE_VALUE_ONLY" : "LOCAL_VALUE_NOT_AUTHENTICATED",
      ...definition, basis: [{ path: schemaPath, anchor: `"${field}"` }, ...definition.basis],
      one_time_bootstrap_requirement: category === "ONE_TIME_BOOTSTRAP_INPUT" ? "REQUIRED" :
        category === "UNDEFINED_CONTRACT" ? "UNDEFINED_CONTRACT" : "NOT_AN_INDIVIDUAL_INPUT",
      runtime_derivation: "NOT_A_CONCRETE_RUNTIME_VALUE",
      source_auto_derivable: category === "SOURCE_DERIVED",
      approval_requirement: category === "DIAGNOSTIC_ONLY" ? "NOT_APPLICABLE" :
        category === "SOURCE_DERIVED" ? "POLICY_BUNDLE_REQUIRED" : "INDEPENDENT_APPROVAL_REQUIRED",
      registration_requirement: category === "ONE_TIME_BOOTSTRAP_INPUT" ? "REQUIRED_AFTER_PROTOCOL_APPROVAL" :
        category === "UNDEFINED_CONTRACT" ? "UNDEFINED_CONTRACT" :
          category === "SOURCE_DERIVED" ? "POLICY_BUNDLE_NOT_SEPARATE_VALUE" : "NOT_APPLICABLE",
      approval_actor: "UNDEFINED_CONTRACT_U02_EXISTING_TRUST_GOVERNANCE_NOT_PRODUCER_SELF_APPROVAL",
      registration_target: "EXISTING_AUTHORITY_AND_INDEPENDENT_CONSUMER_POLICY_PROTOCOL_NOT_IMPLEMENTED",
      registration_state: "NOT_VERIFIED",
      legacy_missing: Array.isArray(missingKeys) && missingKeys.includes(field),
    };
  });
  const counts = Object.fromEntries(DELEGATION_DATA_CLASSES.map((category) => [
    category, inventory.filter((field) => field.data_class === category).length,
  ]));
  const staticInputs = inventory.filter((field) => field.data_class === "ONE_TIME_BOOTSTRAP_INPUT");
  const unresolved = inventory.filter((field) => field.data_class === "UNDEFINED_CONTRACT");
  const manifest = {
    schema_version: 1, scope: "fusou-grant-delegation-minimal-bootstrap-draft-v1",
    lifecycle: "PROPOSED", operational_enabled: false, publication_authorized: false,
    format: "DIAGNOSTIC_PROJECTION_OF_EXISTING_V1_POLICY_NOT_A_NEW_ACCEPTANCE_SCHEMA",
    completeness: "UNDEFINED_CONTRACT", complete_minimum_established: false,
    meaning: "Three currently well-defined static trust selections are not a complete activation bootstrap; protocol decisions can add necessary stable inputs.",
    static_trust_inputs: staticInputs,
    source_derived_rules: inventory.filter((field) => field.data_class === "SOURCE_DERIVED"),
    diagnostic_fields: inventory.filter((field) => field.data_class === "DIAGNOSTIC_ONLY"),
    derivations: derivations.map((derivation) => ({ ...derivation, current_values: null,
      observation: "NOT_OBSERVED", one_time_bootstrap_requirement: "NOT_CONCRETE_BOOTSTRAP_INPUTS" })),
    undefined_contracts: unresolved,
    protocol_requirements: protocols.map((protocol) => ({ ...protocol,
      design_status: "UNDEFINED_CONTRACT", implementation_status: "NOT_IMPLEMENTED",
      basis: protocol.decisions.map(row) })),
    implementation_requirements: implementationRequirements,
    external_registration: { status: "NOT_VERIFIED",
      meaning: "After protocols are defined, independently register/distribute approved policy and service/reader mapping. Offline source cannot prove registration or its absence." },
    oidc: {
      issuer_jwks: "EXISTING_SOURCE_CONSTANTS_ONLY",
      sub_format: "NOT_ASSUMED", current_official_specification: "NOT_CHECKED_OFFLINE",
      repository_subject_settings: "NOT_VERIFIED", immutable_subject_configuration: "NOT_VERIFIED",
      owner_claim_enforcement: "SOURCE_IMPLEMENTED_NOT_EXTERNALLY_OBSERVED",
      job_workflow_claim_semantics_and_availability: "NOT_VERIFIED",
      existing_optional_job_policy: "BOUND_TO_EXISTING_CALLER_NOT_OPTION_A_DELEGATE",
      eligibility_observation_to_authority: "UNDEFINED_CONTRACT",
    },
    required_external_verification: [
      "Authenticate actual GitHub repository/owner identity, subject settings and signed reusable/caller claim semantics without assuming a sub template.",
      "Verify independently approved immutable issuer closure, policy digest/root distribution and current authority/deployment/epoch mapping.",
      "Observe live eligibility/input/capture derivation and authenticated observation transfer to authority.",
      "Observe durable grant issue/restart/read/revoke/CAS/post-await state revalidation and independent consumer reacquisition.",
      "Separately verify exact real archive bytes and formal native/TLSN evidence; a grant does not establish retention or cryptographic verification.",
    ],
  };
  return structuredClone({
    status: coverageErrors.length ? "BLOCKED_IMPLEMENTATION" : "SOURCE_CONTRACT_READY",
    meaning: "CLASSIFICATION_COVERAGE_ONLY_NOT_BOOTSTRAP_READINESS",
    errors: coverageErrors, counts, fields: inventory,
    category_notes: {
      RUNTIME_DERIVED: "No concrete runtime values are v1 bootstrap fields; see manifest derivations.",
      AUTHORITY_STATE_DERIVED: "No concrete consumed-state observations are v1 bootstrap fields; see manifest derivations.",
      EXTERNAL_REGISTRATION_REQUIRED: "No v1 field is registration-only: endpoint/issuer/reader/root semantics need protocol decisions first. Static pin registration remains a separate requirement.",
      SOURCE_DERIVED: "Only source constants/rule labels can be reproduced; this does not prove implementation or approval of their semantics.",
    },
    legacy_missing_fields: inventory.filter((field) => field.legacy_missing).map((field) => ({
      field: field.field, data_class: field.data_class, blocker: field.blocker,
    })),
    minimal_manifest: manifest,
  });
}
