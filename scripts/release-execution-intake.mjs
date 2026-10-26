import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { sha256 } from "./release-bytes.mjs";
import { assertProducerRun, producerWorkflow, parseReleaseRecord, requireRelease } from "./release-build-proof.mjs";
import { assertAuthenticatedReleaseTransport, ReleaseBlocked } from "./release-transport.mjs";
import { EXECUTION_ORIGIN_FILE, executionSubject, executionDescriptor } from "./release-execution-origin.mjs";
import { EVIDENCE_PRODUCTION_SCOPE } from "./release-evidence-producer.mjs";

const proofs = new WeakMap();
const repo = { owner: "tsukasa-u", repo: "FUSOU" };
export const EXECUTION_IMPLEMENTATION_PATHS = Object.freeze([
  ".github/workflows/tlsn-release-eligibility.yml", "scripts/release-execution-origin.mjs",
  "scripts/release-execution-intake.mjs", "scripts/release-build.mjs", "scripts/release-checks.mjs",
  "scripts/release-transport.mjs", "scripts/release-build-proof.mjs", "scripts/release-bytes.mjs",
  "scripts/release-files.mjs", "scripts/release-worker-build.mjs", "scripts/release-worker-source.mjs",
  "scripts/release-worker-imports.mjs", "scripts/release-wasm-proof.mjs",
  "scripts/release-manifest.mjs", "scripts/release-eligibility.mjs",
  "scripts/release-evidence-producer.mjs",
  "scripts/release-archive-http.mjs",
  "scripts/release-archive-job.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-readback.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/origin-trust-contract.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-tool-environment.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-public-configuration.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/wasm-provenance.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-worker-endpoint-mapping.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-dotenvx-inputs.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/authority-key-registry.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/signing-key-registry.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/result-registry-envelope.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/origin-inventory-contract.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/target-approval-contract.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/deployment-attestation.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-independent-verification.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-contract.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/deployment-contract.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/profile-canonical-contract.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/security-registry-set-contract.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/canary-runtime-attestation-key-registry.mjs",
]);
const inputDigest = (inputs) => sha256(Buffer.from(canonicalJson(Object.fromEntries([...inputs].map(
  ([name, raw]) => [name, { sha256: sha256(raw), byte_length: raw.byteLength }])))));
const proofBinding = ({ check, receipt, inputs, context, build }) => ({
  check, context, receipt_sha256: sha256(Buffer.from(canonicalJson(receipt))), inputs_sha256: inputDigest(inputs),
  subject: executionSubject(build.report),
});
export function assertAuthenticatedCrossRunExecution(proof, execution) {
  requireRelease(proof && isDeepStrictEqual(proofs.get(proof), proofBinding(execution)),
    "unauthenticated/mismatched cross-run execution");
}
export function createCrossRunExecutionIntake({ github, run, trustedSha, downloaded, eligibility, publicBuildInputsSha256, checkPolicySha256 }) {
  let authenticated;
  const recheck = async () => {
    assertAuthenticatedReleaseTransport(downloaded, run);
    const fresh = (await github.rest.actions.getWorkflowRun({ ...repo, run_id: run.id })).data;
    assertProducerRun(fresh, run.id, run.run_attempt);
    requireRelease(fresh.head_sha === run.head_sha && fresh.repository.id === run.repository.id,
      "execution producer changed during consumption");
    const artifact = (await github.rest.actions.getArtifact({ ...repo, artifact_id: downloaded.origin.id })).data;
    requireRelease(artifact.id === downloaded.origin.id && artifact.digest === downloaded.origin.digest &&
      artifact.name === downloaded.origin.name && artifact.expired === false &&
      artifact.workflow_run?.id === run.id && artifact.workflow_run.head_sha === run.head_sha &&
      artifact.workflow_run.repository_id === run.repository.id &&
      artifact.workflow_run.head_repository_id === run.repository.id && artifact.workflow_run.head_branch === "main",
    "execution artifact changed during consumption");
  };
  const authenticate = async (execution) => {
    if (!authenticated) authenticated = (async () => {
      await recheck();
      const main = (await github.rest.repos.getBranch({ ...repo, branch: "main" })).data.commit?.sha;
      requireRelease(/^[0-9a-f]{40}$/.test(main), "execution producer main revision");
      const ancestry = (await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${run.head_sha}...${main}` })).data;
      requireRelease(["ahead", "identical"].includes(ancestry.status) && ancestry.merge_base_commit?.sha === run.head_sha,
        "execution producer is not in main history");
      if (!publicBuildInputsSha256) throw new ReleaseBlocked("EXECUTION_INDEPENDENT_RELEASE_INPUT_PIN_MISSING");
      const raw = downloaded.files.get(EXECUTION_ORIGIN_FILE);
      if (!raw) throw new ReleaseBlocked("CROSS_RUN_EXECUTION_ORIGIN_MISSING", "BLOCKED_IMPLEMENTATION");
      const seal = parseReleaseRecord(raw), report = parseReleaseRecord(downloaded.files.get("release-report.json"));
      requireRelease(Object.keys(seal).sort().join() === "checks,issuer,schema_version,scope,subject,unattested_checks" &&
        seal.checks && typeof seal.checks === "object" && !Array.isArray(seal.checks) && Array.isArray(seal.unattested_checks) &&
        [...Object.keys(seal.checks), ...seal.unattested_checks].every((check) =>
          ["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"].includes(check)) &&
        seal.unattested_checks.every((check) => !Object.hasOwn(seal.checks, check)), "execution origin contract");
      const expectedIssuer = { kind: "github-actions-artifact", repository: "tsukasa-u/FUSOU", workflow_path: producerWorkflow,
        run_id: run.id, run_attempt: run.run_attempt, workflow_sha: run.head_sha };
      requireRelease(seal.schema_version === 1 && seal.scope === "fusou-release-execution-origin-v1" &&
        isDeepStrictEqual(seal.issuer, expectedIssuer), "cross-run execution issuer/subject");
      requireRelease(report.commit_sha === eligibility.commit_sha && report.tag === eligibility.tag &&
        report.validation_run_id === eligibility.validation_run_id && report.validation_run_attempt === eligibility.validation_run_attempt &&
        report.build.public_inputs_sha256 === publicBuildInputsSha256 &&
        isDeepStrictEqual(seal.subject, executionSubject(report)), "cross-run execution release subject/input pin");
      requireRelease(/^[0-9a-f]{40}$/.test(trustedSha), "independent execution verifier revision");
      for (const path of EXECUTION_IMPLEMENTATION_PATHS) {
        const [producer, consumer] = await Promise.all([run.head_sha, trustedSha].map(async (ref) =>
          (await github.rest.repos.getContent({ ...repo, ref, path })).data));
        requireRelease(producer.type === "file" && consumer.type === "file" && /^[0-9a-f]{40}$/.test(producer.sha) &&
          producer.sha === consumer.sha, `untrusted execution producer implementation: ${path}`);
      }
      return seal;
    })();
    const seal = await authenticated, { check, receipt, inputs, context, build } = execution;
    assertAuthenticatedReleaseTransport(downloaded, run);
    requireRelease(isDeepStrictEqual(context, { repository: "tsukasa-u/FUSOU", source_sha: eligibility.commit_sha,
      run_id: run.id, run_attempt: run.run_attempt, workflow_sha: run.head_sha }) &&
      Object.entries(context).every(([key, value]) => receipt[key] === value) &&
      isDeepStrictEqual(executionSubject(build.report), seal.subject), "cross-run execution target context");
    const production = build.report.evidence_production;
    if (production && ["archive_readback", "offline_verification"].includes(check)) {
      if (!checkPolicySha256) throw new ReleaseBlocked("EXECUTION_INDEPENDENT_CHECK_POLICY_PIN_MISSING");
      requireRelease(production.schema_version === 1 && production.scope === EVIDENCE_PRODUCTION_SCOPE &&
        production.check_policy_sha256 === checkPolicySha256 &&
        Object.entries(context).every(([key, value]) => production[key] === value),
      "cross-run collector independent policy/context binding");
    }
    const recordRaw = downloaded.files.get(`check-${check}.json`);
    if (!seal.checks?.[check]) throw new ReleaseBlocked(`UNATTESTED_${check.toUpperCase()}_EXECUTION`, "BLOCKED_IMPLEMENTATION");
    requireRelease(recordRaw instanceof Uint8Array && isDeepStrictEqual(seal.checks[check],
      executionDescriptor(recordRaw, Buffer.from(canonicalJson(receipt)))) &&
      receipt.input_sha256 === inputDigest(inputs), "cross-run execution exact record/receipt/raw input binding");
    const proof = Object.freeze({});
    proofs.set(proof, structuredClone(proofBinding(execution)));
    return proof;
  };
  return { authenticate, recheck };
}
