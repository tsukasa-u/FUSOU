import { pathToFileURL } from "node:url";
import { readRegularFile } from "./release-files.mjs";
import { evaluateReleaseRun } from "./release-eligibility.mjs";

const POLICY_SCOPE = "fusou-grant-delegation-bootstrap-policy-v1";
const policyFields = [
  "schema_version", "scope", "lifecycle", "operational_enabled", "publication_authorized",
  "issuer", "jwks_uri", "issue_audience", "read_audience", "repository", "repository_id", "repository_owner_id",
  "caller_workflow", "caller_revision_policy", "delegate_workflow", "delegate_revision", "delegate_claims_contract",
  "event", "ref", "eligibility_contract", "workflow_source_rule", "authority_endpoint", "authority_deployment_identity",
  "authority_state_epoch", "policy_pin_source_contract", "policy_digest_contract", "active_policy_registry_identity", "public_input_derivation_contract",
  "capture_selection_contract", "capture_state_contract", "grant_issuer_identity", "grant_scope_contract",
  "grant_wire_contract", "grant_ttl_ms", "freshness_and_clock_contract", "revocation_contract", "state_revision_cas_contract",
  "external_io_contract", "idempotence_contract", "consumer_read_endpoint", "consumer_identity_contract",
  "consumer_recheck_contract", "source_inventory_contract",
];
const rootKeys = ["$schema", "$id", "title", "description", "type", "additionalProperties", "required", "properties"];
const ruleKeys = ["type", "const", "enum", "minLength", "pattern", "minimum", "maximum", "description", "x-input-origin", "x-bootstrap-input"];
const scalarTypes = ["string", "integer", "boolean", "null"];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const typeMatches = (value, type) => type === "null" ? value === null :
  type === "integer" ? Number.isSafeInteger(value) : typeof value === type;
const types = (rule) => Array.isArray(rule.type) ? rule.type : [rule.type];
const issue = (path, code) => ({ path, code });

// Only this flat bootstrap schema profile is supported; unknown keywords fail closed.
function validateSchema(schema) {
  if (!record(schema) || Object.keys(schema).some((key) => !rootKeys.includes(key)) ||
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    schema.$id !== "urn:fusou:tlsn-grant-delegation:bootstrap:v1" ||
    schema.type !== "object" || schema.additionalProperties !== false || !record(schema.properties) ||
    !Array.isArray(schema.required)) return [issue("$schema", "UNSUPPORTED_BOOTSTRAP_SCHEMA")];
  const keys = Object.keys(schema.properties);
  if (keys.length !== policyFields.length || policyFields.some((key) => !Object.hasOwn(schema.properties, key)) ||
    new Set(schema.required).size !== keys.length || schema.required.length !== keys.length ||
    keys.some((key) => !schema.required.includes(key)) ||
    schema.properties.schema_version?.const !== 1 || schema.properties.scope?.const !== POLICY_SCOPE ||
    schema.properties.operational_enabled?.const !== false || schema.properties.publication_authorized?.const !== false) {
    return [issue("$schema", "BOOTSTRAP_SCHEMA_VERSION_OR_REQUIRED_FIELDS_INVALID")];
  }
  for (const [key, rule] of Object.entries(schema.properties)) {
    if (!record(rule) || Object.keys(rule).some((name) => !ruleKeys.includes(name)) ||
      types(rule).length === 0 || new Set(types(rule)).size !== types(rule).length ||
      types(rule).some((type) => !scalarTypes.includes(type)) ||
      Object.hasOwn(rule, "minLength") && (!types(rule).includes("string") || !Number.isSafeInteger(rule.minLength) || rule.minLength < 0) ||
      Object.hasOwn(rule, "minimum") && (!types(rule).includes("integer") || !Number.isSafeInteger(rule.minimum)) ||
      Object.hasOwn(rule, "maximum") && (!types(rule).includes("integer") || !Number.isSafeInteger(rule.maximum) ||
        rule.minimum !== undefined && rule.maximum < rule.minimum) ||
      Object.hasOwn(rule, "enum") && (!Array.isArray(rule.enum) || rule.enum.length === 0 ||
        rule.enum.some((value) => !types(rule).some((type) => typeMatches(value, type)))) ||
      Object.hasOwn(rule, "const") && !types(rule).some((type) => typeMatches(rule.const, type)) ||
      Object.hasOwn(rule, "x-bootstrap-input") && typeof rule["x-bootstrap-input"] !== "boolean" ||
      Object.hasOwn(rule, "x-input-origin") && !["SOURCE_CONFIRMED", "DESIGN_PROPOSAL", "EXTERNAL_INPUT"].includes(rule["x-input-origin"])) {
      return [issue(`$schema.properties.${key}`, "UNSUPPORTED_BOOTSTRAP_SCHEMA_RULE")];
    }
    if (Object.hasOwn(rule, "pattern")) {
      if (typeof rule.pattern !== "string" || !types(rule).includes("string")) return [issue(key, "INVALID_SCHEMA_PATTERN")];
      try { new RegExp(rule.pattern, "u"); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return [issue(`$schema.properties.${key}`, "INVALID_SCHEMA_PATTERN")];
      }
    }
  }
  return [];
}

export function validateDelegationPolicy(policy, schema) {
  const errors = validateSchema(schema);
  if (errors.length) return errors;
  if (!record(policy)) return [issue("$policy", "POLICY_OBJECT_REQUIRED")];
  for (const key of Object.keys(policy)) {
    if (!Object.hasOwn(schema.properties, key)) errors.push(issue(key, "UNKNOWN_POLICY_FIELD"));
  }
  for (const [key, rule] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(policy, key)) { errors.push(issue(key, "REQUIRED_POLICY_FIELD")); continue; }
    const value = policy[key];
    if (!types(rule).some((type) => typeMatches(value, type)) ||
      Object.hasOwn(rule, "const") && value !== rule.const ||
      rule.enum && !rule.enum.includes(value) ||
      typeof value === "string" && (value.length < (rule.minLength ?? 0) || rule.pattern && !new RegExp(rule.pattern, "u").test(value)) ||
      typeof value === "number" && (rule.minimum !== undefined && value < rule.minimum ||
        rule.maximum !== undefined && value > rule.maximum)) {
      errors.push(issue(key, "POLICY_FIELD_INVALID"));
    }
  }
  for (const key of ["authority_endpoint", "consumer_read_endpoint"]) {
    if (typeof policy[key] !== "string") continue;
    try {
      const url = new URL(policy[key]);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== policy[key]) {
        errors.push(issue(key, "CANONICAL_HTTPS_ENDPOINT_REQUIRED"));
      }
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      errors.push(issue(key, "CANONICAL_HTTPS_ENDPOINT_REQUIRED"));
    }
  }
  if (typeof policy.issue_audience === "string" && policy.issue_audience === policy.read_audience) {
    errors.push(issue("read_audience", "PURPOSE_SEPARATED_AUDIENCES_REQUIRED"));
  }
  return errors;
}

export function inspectDelegationBootstrap({ policy, schema }) {
  const errors = validateDelegationPolicy(policy, schema);
  const schemaValid = validateSchema(schema).length === 0;
  const missing = schemaValid ? Object.entries(schema.properties)
    .filter(([key, rule]) => rule["x-bootstrap-input"] &&
      (!record(policy) || policy[key] === null || !Object.hasOwn(policy, key) || errors.some((error) => error.path === key)))
    .map(([key]) => key) : [];
  return {
    schema_version: 1, scope: "fusou-grant-delegation-bootstrap-preflight-v1",
    status: errors.length ? "BLOCKED_IMPLEMENTATION" : "BLOCKED_POLICY_NOT_APPROVED",
    source_contract: { status: errors.length ? "BLOCKED_IMPLEMENTATION" : "SOURCE_CONTRACT_READY", errors,
      meaning: "BOOTSTRAP_SCHEMA_AND_POLICY_SHAPE_ONLY_NOT_AUTHORIZATION_PROTOCOL_READINESS" },
    policy_approval: { status: "BLOCKED_POLICY_NOT_APPROVED",
      claimed_lifecycle: record(policy) && ["PROPOSED", "ACTIVE", "REVOKED"].includes(policy.lifecycle) ? policy.lifecycle : "UNKNOWN",
      independent_active_pin: "NOT_VERIFIED",
      reason: "OFFLINE_PREFLIGHT_HAS_NO_INDEPENDENT_POLICY_REGISTRY_ADAPTER" },
    external_inputs: { status: "BLOCKED_EXTERNAL_INPUTS", missing,
      registration: "NOT_VERIFIED", reason: "LOCAL_VALUES_DO_NOT_PROVE_APPROVAL_OR_SERVICE_REGISTRATION" },
    implementation: { status: "BLOCKED_IMPLEMENTATION", blockers: [
      "GRANT_AUTHORIZATION_API_NOT_REGISTERED",
      "ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED",
      "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED",
      "READ_ONLY_GRANT_READER_NOT_REGISTERED",
      "DELEGATION_POLICY_REGISTRY_ADAPTER_NOT_REGISTERED",
      "DELEGATION_POLICY_ROOT_DIGEST_DISTRIBUTION_CONTRACT_UNDEFINED",
      "ISSUED_GRANT_SCOPE_WIRE_REVOCATION_CAS_CONTRACT_UNDEFINED",
      "INDEPENDENT_RELEASE_INPUT_AND_CAPTURE_SELECTION_CONTRACT_UNDEFINED",
      "SIGNED_REUSABLE_IDENTITY_AND_TRUSTED_CLOSURE_NOT_VERIFIED",
    ] },
    runtime_authorization_enabled: false, publication_authorized: false,
    network_access_performed: false, signing_performed: false,
    deployment_status: "NOT_CHECKED", production_acceptance: "BLOCKED",
    unattested_checks: ["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"],
    offline_verification: "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED",
  };
}

export async function readDelegationBootstrapSources() {
  const [schema, policy] = await Promise.all([
    readRegularFile(new URL("./tlsn-grant-delegation.v1.schema.json", import.meta.url)),
    readRegularFile(new URL("./tlsn-grant-delegation.draft.json", import.meta.url)),
  ]);
  return { schema: JSON.parse(schema.toString("utf8")), policy: JSON.parse(policy.toString("utf8")) };
}

export async function getDelegationBootstrapPreflight() {
  return inspectDelegationBootstrap(await readDelegationBootstrapSources());
}

const sha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;

// The disabled workflow's revision input is a diagnostic selector, never a trusted pin.
export async function evaluateDelegationDiagnostic({ github, caller, implementationSha, validationRunId, validationRunAttempt }) {
  if (!record(caller) || !positive(caller.run_id) || !positive(caller.run_attempt) || !sha(caller.workflow_sha) ||
    caller.repository !== "tsukasa-u/FUSOU" || caller.event !== "workflow_run" || caller.ref !== "refs/heads/main" ||
    caller.workflow_ref !== "tsukasa-u/FUSOU/.github/workflows/tlsn-release-eligibility.yml@refs/heads/main" ||
    !sha(implementationSha) || !positive(validationRunId) || !positive(validationRunAttempt)) {
    throw new Error("delegation diagnostic caller/revision/validation selectors invalid");
  }
  const repository = { owner: "tsukasa-u", repo: "FUSOU" };
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...repository, run_id: caller.run_id });
  if (run.id !== caller.run_id || run.run_attempt !== caller.run_attempt || run.head_sha !== caller.workflow_sha ||
    run.repository?.full_name !== caller.repository || run.head_repository?.full_name !== caller.repository ||
    run.path !== ".github/workflows/tlsn-release-eligibility.yml" || run.event !== caller.event || run.head_branch !== "main" ||
    !(run.status === "in_progress" || run.status === "completed" && run.conclusion === "success")) {
    throw new Error("delegation diagnostic live caller metadata mismatch");
  }
  const eligibility = await evaluateReleaseRun({ github, repository, runId: validationRunId, trustedSha: implementationSha });
  if (eligibility.validation_run_attempt !== validationRunAttempt) throw new Error("delegation diagnostic validation attempt mismatch");
  return {
    schema_version: 1, scope: "fusou-grant-delegation-diagnostic-v1", status: "DERIVED_NOT_AUTHORIZED",
    caller: { ...caller }, validation_run_id: validationRunId, validation_run_attempt: validationRunAttempt,
    release_source_sha: eligibility.commit_sha,
    implementation_revision: { sha: implementationSha, source: "CALLER_SELECTED_DIAGNOSTIC_LOCATOR", verification: "NOT_VERIFIED" },
    delegated_workflow_identity: "NOT_VERIFIED", job_workflow_sha: null,
    eligibility, production_grant_eligible: false, authorization_status: "BLOCKED_IMPLEMENTATION",
    publication_authorized: false, deployment_status: "NOT_CHECKED", production_acceptance: "BLOCKED",
    blockers: ["DELEGATION_POLICY_NOT_APPROVED", "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED"],
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/release-grant-delegation.mjs (no paths, tokens or activation options)");
  process.stdout.write(`${JSON.stringify(await getDelegationBootstrapPreflight(), null, 2)}\n`);
  process.exitCode = 1;
}
