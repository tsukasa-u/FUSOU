// Key-free: fixed source reads and API/authority doubles only; no service or native execution.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { readRegularFile } from "./release-files.mjs";
import {
  readDelegationBootstrapSources, validateDelegationPolicy, inspectDelegationBootstrap,
  getDelegationBootstrapPreflight, evaluateDelegationDiagnostic,
} from "./release-grant-delegation.mjs";
import { checkFixture } from "./release-check-fixture.mjs";
import { jsonBytes, verifyReleaseChecks } from "./release-checks.mjs";
import { sha256 } from "./release-bytes.mjs";

const sources = await readDelegationBootstrapSources();
const inspect = (policy) => inspectDelegationBootstrap({ schema: sources.schema, policy });
const draft = () => structuredClone(sources.policy);
const readSource = async (path) => (await readRegularFile(new URL(`../${path}`, import.meta.url))).toString("utf8");
const checks = ["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"];
function assertBlocked(report) {
  assert.equal(report.runtime_authorization_enabled, false);
  assert.equal(report.publication_authorized, false);
  assert.equal(report.policy_approval.status, "BLOCKED_POLICY_NOT_APPROVED");
  assert.equal(report.policy_approval.independent_active_pin, "NOT_VERIFIED");
  assert.equal(report.external_inputs.status, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(report.external_inputs.registration, "NOT_VERIFIED");
  assert.equal(report.implementation.status, "BLOCKED_IMPLEMENTATION");
  for (const code of ["ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED", "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED"]) {
    assert(report.implementation.blockers.includes(code));
  }
  assert.equal(report.deployment_status, "NOT_CHECKED");
  assert.equal(report.production_acceptance, "BLOCKED");
  assert.equal(report.offline_verification, "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED");
  assert.deepEqual(report.unattested_checks, checks);
}
function filledPolicy() {
  const policy = draft();
  for (const [key, rule] of Object.entries(sources.schema.properties)) {
    if (!rule["x-bootstrap-input"]) continue;
    policy[key] = key === "delegate_revision" ? "c".repeat(40) :
      ["repository_id", "repository_owner_id"].includes(key) ? "7" :
      key.endsWith("_endpoint") ? `https://synthetic.invalid/${key}` :
      key === "grant_ttl_ms" ? 60000 : `synthetic:${key}`;
  }
  return policy;
}

test("valid PROPOSED source shape is ready only as an offline planning contract", async () => {
  assert.deepEqual(validateDelegationPolicy(draft(), sources.schema), []);
  const report = await getDelegationBootstrapPreflight();
  assert.equal(report.status, "BLOCKED_POLICY_NOT_APPROVED");
  assert.equal(report.source_contract.status, "SOURCE_CONTRACT_READY");
  assert.equal(report.policy_approval.claimed_lifecycle, "PROPOSED");
  assert.equal(report.network_access_performed, false);
  assert.equal(report.signing_performed, false);
  assertBlocked(report);
  assert.deepEqual(report.external_inputs.missing, Object.entries(sources.schema.properties)
    .filter(([, rule]) => rule["x-bootstrap-input"]).map(([key]) => key));
});
test("empty, absent, array and scalar policies never yield ready or authorized state", () => {
  for (const policy of [{}, undefined, null, [], "ACTIVE", true]) {
    const report = inspect(policy);
    assert.equal(report.source_contract.status, "BLOCKED_IMPLEMENTATION");
    assert(report.source_contract.errors.length > 0);
    assertBlocked(report);
  }
});
test("each required policy field and unsupported version are rejected", () => {
  for (const key of sources.schema.required) {
    const policy = draft(); delete policy[key];
    assert(inspect(policy).source_contract.errors.some((error) => error.path === key));
    assertBlocked(inspect(policy));
  }
  for (const version of [0, 2, "1", null]) {
    const policy = draft(); policy.schema_version = version;
    assert(inspect(policy).source_contract.errors.some((error) => error.path === "schema_version"));
  }
});
test("invalid or weakened schema and unknown validation keywords fail closed", () => {
  for (const mutate of [
    (schema) => { schema.properties.schema_version.const = 2; },
    (schema) => { schema.required.pop(); },
    (schema) => { schema.required.push(schema.required[0]); },
    (schema) => { delete schema.properties.repository_id; schema.required = schema.required.filter((key) => key !== "repository_id"); },
    (schema) => { schema.additionalProperties = true; },
    (schema) => { schema.$ref = "https://synthetic.invalid/schema"; },
    (schema) => { schema.properties.repository_id.format = "unimplemented"; },
    (schema) => { schema.properties.repository_id.pattern = "["; },
    (schema) => { schema.properties.repository_id.type = "object"; },
    (schema) => { schema.properties.grant_ttl_ms.maximum = 0; },
  ]) {
    const schema = structuredClone(sources.schema); mutate(schema);
    const report = inspectDelegationBootstrap({ schema, policy: draft() });
    assert.equal(report.source_contract.status, "BLOCKED_IMPLEMENTATION");
    assert(report.source_contract.errors.length > 0);
    assertBlocked(report);
  }
});
test("fully populated PROPOSED, ACTIVE and REVOKED claims cannot authenticate a policy pin", () => {
  for (const lifecycle of ["PROPOSED", "ACTIVE", "REVOKED"]) {
    const policy = filledPolicy(); policy.lifecycle = lifecycle;
    const before = structuredClone(policy), report = inspect(policy);
    assert.equal(report.source_contract.status, "SOURCE_CONTRACT_READY");
    assert.deepEqual(report.external_inputs.missing, []);
    assert.equal(report.policy_approval.claimed_lifecycle, lifecycle);
    assertBlocked(report);
    assert.deepEqual(policy, before);
  }
});
test("self-asserted approval, pins, registration, PASS and authenticated flags are not trust inputs", () => {
  for (const extra of [
    { approved: true }, { authenticated: true, status: "PASS" },
    { active_policy_sha256: "a".repeat(43) }, { grant_reader_registered: true, publication_provider_registered: true },
    { authority_registration: { authenticated: true } },
  ]) {
    const report = inspect({ ...filledPolicy(), ...extra });
    assert.equal(report.source_contract.status, "BLOCKED_IMPLEMENTATION");
    assert(report.source_contract.errors.some((error) => error.code === "UNKNOWN_POLICY_FIELD"));
    assertBlocked(report);
  }
  for (const field of ["operational_enabled", "publication_authorized"]) {
    const policy = draft(); policy[field] = true;
    assert.equal(inspect(policy).source_contract.status, "BLOCKED_IMPLEMENTATION");
    assertBlocked(inspect(policy));
  }
});
test("missing independent repository/workflow/release-input/capture/service contracts are enumerated", () => {
  const report = inspect(draft());
  for (const key of ["repository_id", "repository_owner_id", "delegate_revision", "public_input_derivation_contract",
    "capture_selection_contract", "active_policy_registry_identity", "issue_audience", "read_audience",
    "authority_endpoint", "authority_deployment_identity", "consumer_read_endpoint", "consumer_identity_contract"]) {
    assert(report.external_inputs.missing.includes(key), key);
  }
  assertBlocked(report);
});
test("malformed identities, revisions, lifetimes, endpoints and mixed audiences are rejected without connection", () => {
  for (const [field, value] of [
    ["repository_id", "0"], ["repository_owner_id", "unknown"], ["delegate_revision", "main"],
    ["repository", "foreign/repository"], ["caller_workflow", "other.yml"], ["event", "pull_request"],
    ["grant_ttl_ms", 0], ["grant_ttl_ms", Number.MAX_SAFE_INTEGER + 1], ["grant_ttl_ms", 1.5],
    ["authority_endpoint", "https://["], ["authority_endpoint", "http://synthetic.invalid/"],
    ["consumer_read_endpoint", "https://user:password@synthetic.invalid/"],
    ["consumer_read_endpoint", "https://synthetic.invalid/?token=value"],
    ["read_audience", "synthetic:issue_audience"],
  ]) {
    const policy = filledPolicy(); policy[field] = value;
    assert(inspect(policy).source_contract.errors.some((error) => error.path === field), field);
    assertBlocked(inspect(policy));
  }
});
test("release-specific concrete values cannot become recurring bootstrap requirements", () => {
  for (const field of ["source_sha", "workflow_sha", "run_id", "run_attempt", "release_input_sha256",
    "capture_id", "session_id", "job_id", "verification_attempt_id", "binding_id", "object_version", "raw_sha256"]) {
    assert(!Object.hasOwn(sources.schema.properties, field));
    const report = inspect({ ...draft(), [field]: "self-selected" });
    assert(report.source_contract.errors.some((error) => error.path === field && error.code === "UNKNOWN_POLICY_FIELD"));
    assertBlocked(report);
  }
});
test("CLI has no arbitrary-path or activation option and exits blocked even for valid source", () => {
  for (const args of [[], ["--policy", "arbitrary-input.json"], ["--activate"]]) {
    assert.throws(() => execFileSync(process.execPath, ["scripts/release-grant-delegation.mjs", ...args], {
      cwd: new URL("../", import.meta.url), env: {}, stdio: "pipe",
    }), (error) => {
      assert.equal(error.status, 1);
      if (args.length) assert.match(error.stderr.toString(), /no paths, tokens or activation options/);
      else assertBlocked(JSON.parse(error.stdout));
      return true;
    });
  }
});
test("preflight and policy JSON cannot be used as a registered grant provider by the independent verifier", async () => {
  for (const provider of [inspect(draft()), { ...inspect(filledPolicy()), status: "PASS", authenticated: true }, filledPolicy()]) {
    const f = await checkFixture(), raw = jsonBytes({ ...f.checkPolicy, grant_provider: provider });
    let archiveCalls = 0, nativeCalls = 0;
    await assert.rejects(verifyReleaseChecks(f.args, { ...f.config, checkPolicyBytes: raw, checkPolicySha256: sha256(raw),
      authenticateArchiveReadback: async () => { archiveCalls++; throw new Error("unexpected archive authentication"); },
      authenticateOfflineExecution: async () => { nativeCalls++; throw new Error("unexpected native authentication"); },
    }), (error) => {
      assert.equal(error.check_results.archive_readback.blocker, "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED");
      assert.equal(error.check_results.offline_verification.blocker, "VERIFIED_ARCHIVE_READBACK_REQUIRED");
      return true;
    });
    assert.equal(archiveCalls, 0); assert.equal(nativeCalls, 0);
  }
});

function diagnosticFixture(tag = "fusou-v0.6.0") {
  const sourceSha = "a".repeat(40), callerSha = "b".repeat(40), implementationSha = "c".repeat(40);
  const identity = { full_name: "tsukasa-u/FUSOU" };
  const caller = { repository: identity.full_name, run_id: 10, run_attempt: 2, workflow_sha: callerSha,
    workflow_ref: `${identity.full_name}/.github/workflows/tlsn-release-eligibility.yml@refs/heads/main`,
    event: "workflow_run", ref: "refs/heads/main" };
  const state = {
    caller: { id: 10, run_attempt: 2, head_sha: callerSha, repository: identity, head_repository: identity,
      path: ".github/workflows/tlsn-release-eligibility.yml", event: "workflow_run", head_branch: "main", status: "in_progress" },
    validation: { id: 20, run_attempt: 3, head_sha: sourceSha, repository: identity, head_repository: identity,
      path: ".github/workflows/tlsn-tag-validation.yml", event: "push", head_branch: tag, status: "completed", conclusion: "success" },
    tagSha: sourceSha, comparison: { status: "ahead", merge_base_commit: { sha: sourceSha } },
  };
  const calls = [];
  const github = { rest: {
    actions: { getWorkflowRun: async ({ run_id }) => {
      calls.push(run_id); return { data: run_id === 10 ? state.caller : state.validation };
    } },
    git: { getRef: async () => ({ data: { object: { type: "commit", sha: state.tagSha } } }) },
    repos: {
      getBranch: async () => ({ data: { commit: { sha: callerSha } } }),
      compareCommitsWithBasehead: async () => ({ data: state.comparison }),
      getContent: async () => ({ data: { type: "file", sha: "d".repeat(40) } }),
    },
  } };
  return { state, calls, github, sourceSha, options: { github, caller, implementationSha, validationRunId: 20, validationRunAttempt: 3 } };
}
test("diagnostic reuses live Production eligibility but keeps all three SHAs and both run/attempt pairs distinct", async () => {
  const f = diagnosticFixture(), report = await evaluateDelegationDiagnostic(f.options);
  assert.deepEqual(f.calls, [10, 20]);
  assert.equal(report.status, "DERIVED_NOT_AUTHORIZED");
  assert.equal(report.caller.workflow_sha, "b".repeat(40));
  assert.equal(report.implementation_revision.sha, "c".repeat(40));
  assert.equal(report.release_source_sha, "a".repeat(40));
  assert.equal(report.caller.run_id, 10); assert.equal(report.caller.run_attempt, 2);
  assert.equal(report.validation_run_id, 20); assert.equal(report.validation_run_attempt, 3);
  assert.equal(report.eligibility.status, "PRODUCTION_ELIGIBLE");
  assert.equal(report.implementation_revision.verification, "NOT_VERIFIED");
  assert.equal(report.delegated_workflow_identity, "NOT_VERIFIED");
  assert.equal(report.job_workflow_sha, null);
  assert.equal(report.production_grant_eligible, false);
  assert.equal(report.publication_authorized, false);
});
test("development diagnostic never becomes Production eligibility", async () => {
  const f = diagnosticFixture("fusou-dev-candidate.1"), report = await evaluateDelegationDiagnostic(f.options);
  assert.equal(report.eligibility.status, "DEVELOPMENT_VALIDATED");
  assert.equal(report.production_grant_eligible, false);
  assert.equal(report.status, "DERIVED_NOT_AUTHORIZED");
});
test("caller selectors and live run/revision/attempt substitutions reject", async () => {
  for (const [field, value] of [["repository", "foreign/repo"], ["workflow_ref", "other"], ["event", "push"],
    ["ref", "refs/heads/other"], ["workflow_sha", "main"], ["run_id", 0], ["run_attempt", 0]]) {
    const f = diagnosticFixture(); f.options.caller[field] = value;
    await assert.rejects(evaluateDelegationDiagnostic(f.options), /selectors invalid/);
    assert.deepEqual(f.calls, []);
  }
  for (const change of [{ run_attempt: 1 }, { head_sha: "e".repeat(40) }, { path: "other.yml" },
    { head_repository: { full_name: "foreign/repo" } }, { event: "push" }, { head_branch: "other" },
    { status: "completed", conclusion: "failure" }]) {
    const f = diagnosticFixture(); Object.assign(f.state.caller, change);
    await assert.rejects(evaluateDelegationDiagnostic(f.options), /live caller metadata mismatch/);
  }
  const f = diagnosticFixture(); f.options.validationRunAttempt = 4;
  await assert.rejects(evaluateDelegationDiagnostic(f.options), /validation attempt mismatch/);
});
test("tag changes, main ancestry and API errors propagate instead of yielding successful diagnostics", async () => {
  const moved = diagnosticFixture(); moved.state.tagSha = "e".repeat(40);
  await assert.rejects(evaluateDelegationDiagnostic(moved.options), /tag moved/);
  const unrelated = diagnosticFixture(); unrelated.state.comparison.status = "diverged";
  await assert.rejects(evaluateDelegationDiagnostic(unrelated.options), /main history/);
  const unavailable = diagnosticFixture();
  unavailable.github.rest.repos.getBranch = async () => { throw new Error("synthetic API unavailable"); };
  await assert.rejects(evaluateDelegationDiagnostic(unavailable.options), /synthetic API unavailable/);
});
test("reusable source has exactly one fixed-disabled job, immutable action locators and no issuance permissions", async () => {
  const yaml = await readSource(".github/workflows/tlsn-grant-delegation.yml");
  assert.match(yaml, /on:\n  workflow_call:/);
  const jobs = yaml.slice(yaml.indexOf("jobs:\n"));
  assert.deepEqual([...jobs.matchAll(/^  ([A-Za-z_][A-Za-z0-9_-]*):\s*$/gm)].map((match) => match[1]), ["diagnostic"]);
  assert.match(yaml, /permissions:\n  contents: read\n  actions: read/);
  assert.match(yaml, /  diagnostic:\n(?:    #[^\n]*\n)*    if: \$\{\{ false \}\}/);
  assert.match(yaml, /evaluateDelegationDiagnostic/);
  assert.match(yaml, /workflow_sha: process\.env\.GITHUB_WORKFLOW_SHA/);
  assert.match(yaml, /implementationSha !== process\.env\.CANDIDATE_IMPLEMENTATION_SHA/);
  assert.match(yaml, /persist-credentials: false/);
  assert.doesNotMatch(yaml, /id-token:|: write|secrets:|secrets\.|environment:|getIDToken|ACTIONS_ID_TOKEN|fetch\(|curl |pnpm |cargo |wrangler|workflow_dispatch:|push:|pull_request:/);
  for (const [, action] of yaml.matchAll(/uses: (\S+)/g)) assert.match(action, /@[0-9a-f]{40}$/);
});
test("existing runtime consumers and release workflows are not wired to the new planning report or workflow", async () => {
  for (const path of [
    "scripts/release-grant-provider.mjs", "scripts/release-archive-provenance.mjs", "scripts/release-execution-intake.mjs",
    "scripts/release-consumer.mjs", "scripts/release-archive-http.mjs", "scripts/release-archive-job.mjs",
    "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs",
    "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs",
    "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts",
    ".github/workflows/tlsn-release-eligibility.yml", ".github/workflows/tlsn-release-consumer.yml",
  ]) {
    assert.doesNotMatch(await readSource(path), /release-grant-delegation|tlsn-grant-delegation|SOURCE_CONTRACT_READY/, path);
  }
});
