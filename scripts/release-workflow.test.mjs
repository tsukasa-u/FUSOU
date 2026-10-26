import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
test("development tag validation has no privileged event, secrets, environments or write permission", () => {
  const yaml = read("tlsn-tag-validation.yml");
  assert.match(yaml, /'fusou-dev-\*'/);
  assert.match(yaml, /'fusou-v\*'/);
  assert.match(yaml, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(yaml, /persist-credentials: false/);
  assert.doesNotMatch(yaml, /secrets\.|id-token:|: write|environment:|pull_request_target|workflow_run/);
  assert.doesNotMatch(yaml, /merge-base|refs\/heads\/main|cargo |pnpm install/);
});
test("coordinator only uses trusted main code and API metadata, never tag code or downloaded artifacts", () => {
  const yaml = read("tlsn-release-eligibility.yml");
  assert.match(yaml, /workflow_run:/);
  assert.match(yaml, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(yaml, /context\.ref !== 'refs\/heads\/main'/);
  assert.match(yaml, /trustedSha !== context\.sha/);
  assert.match(yaml, /persist-credentials: false/);
  assert.match(yaml, /actions: read/);
  assert.match(yaml, /contents: read/);
  assert.match(yaml, /core\.setFailed/);
  assert.match(yaml, /if: always\(\)/);
  const buildJob = yaml.slice(yaml.indexOf("  eligibility:"), yaml.indexOf("  archive-evidence:"));
  const archiveJob = yaml.slice(yaml.indexOf("  archive-evidence:"));
  assert.doesNotMatch(buildJob, /id-token:|: write/);
  assert.doesNotMatch(yaml, /secrets\.|environment:|download-artifact|ref:.*head_sha/);
  assert.equal((yaml.match(/id-token: write/g) ?? []).length, 1);
  assert.match(archiveJob, /needs: eligibility/);
  assert.match(archiveJob, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(archiveJob, /produceArchiveJob/);
  assert.match(archiveJob, /evaluateReleaseRun/);
  assert.doesNotMatch(archiveJob, /generateReleaseBuild|pnpm |cargo |exec.*artifact/);
  assert.match(buildJob, /httpEnabled: false/);
  assert.match(yaml, /report\.status === 'PRODUCTION_ELIGIBLE'/);
  assert.match(yaml, /recheckEligibility: \(\) => evaluateReleaseRun/);
  assert.match(yaml, /packProducerTransport/);
  assert.match(yaml, /name: fusou-release-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.match(yaml, /path: release-transport.json/);
  assert.match(yaml, /WORKER_BUILD_ENABLED: \$\{\{ vars.FUSOU_RELEASE_WORKER_BUILD_ENABLED \}\}/);
  assert.match(yaml, /workerBuildAuthorized: process.env.WORKER_BUILD_ENABLED === 'true'/);
  assert.match(yaml, /report.worker_source = await inspectWorkerSourceAt/);
  assert.match(yaml, /CHECK_INPUT_SHA256: \$\{\{ vars.FUSOU_RELEASE_CHECK_INPUTS_SHA256 \}\}/);
  assert.match(yaml, /report.status === 'PRODUCTION_ELIGIBLE' && report.build\?\.status === 'BUILD_OUTPUTS_GENERATED'/);
  assert.match(yaml, /collectReleaseEvidence/);
  assert.match(yaml, /workflow_ref: process.env.GITHUB_WORKFLOW_REF/);
  assert.match(yaml, /report.evidence_production = production.report/);
  assert.match(yaml, /capturedChecks = production.executions/);
  assert.match(yaml, /readRegularFile\(join\(process.env.GITHUB_WORKSPACE, 'release-output', name\)\), \{ capturedChecks \}/);
  assert.doesNotMatch(yaml, /R2_ACCESS_KEY|CLOUDFLARE_API_TOKEN|wrangler.*deploy/);
});
test("legacy publishing is explicitly blocked before any environment-qualified privileged job", () => {
  const yaml = read("publish_and_create_version_tag.yml");
  const gate = yaml.slice(yaml.indexOf("  release-gate:"), yaml.indexOf("  create-release:"));
  assert.match(gate, /refs\/heads\/main/);
  assert.match(gate, /BLOCKED_EXTERNAL_INPUTS/);
  assert.match(gate, /exit 1/);
  assert.doesNotMatch(gate, /secrets\.|: write|environment:/);
  assert.match(yaml, /create-release:\n    needs: release-gate\n    environment: production-release/);
  assert.equal((yaml.match(/environment: production-release/g) ?? []).length, 4);
});
test("unsigned generation does not introduce an unpinned new external Action dependency", () => {
  const yaml = read("tlsn-release-eligibility.yml");
  assert.deepEqual([...yaml.matchAll(/uses: (\S+)/g)].map((m) => m[1]), [
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  ]);
  const build = readFileSync(new URL("./release-build.mjs", import.meta.url), "utf8");
  assert.match(build, /--frozen-lockfile/);
  assert.match(build, /http\.extraHeader/);
  assert.doesNotMatch(build, /TAURI_SIGNING_PRIVATE|DOTENV_PRIVATE|wrangler.*deploy|createRelease|updateRelease/);
});
test("independent consumer checks out only immutable trusted main code and has no publication authority", () => {
  const yaml = read("tlsn-release-consumer.yml");
  assert.match(yaml, /workflows: \[FUSOU release eligibility\]/);
  assert.match(yaml, /ref: \$\{\{ github.sha \}\}/);
  assert.match(yaml, /context.ref !== 'refs\/heads\/main'/);
  assert.match(yaml, /trustedSha !== context.sha/);
  assert.match(yaml, /runAttempt: context.payload.workflow_run.run_attempt/);
  assert.match(yaml, /contents: read/); assert.match(yaml, /actions: read/);
  assert.doesNotMatch(yaml, /secrets\.|environment:|: write|id-token:|download-artifact|wrangler|cargo |pnpm |createRelease/);
  assert.match(yaml, /publication_authorized: false/);
  assert.match(yaml, /FUSOU_RELEASE_CHECK_INPUTS_SHA256/);
  assert.match(yaml, /scripts\/release-check-public-inputs.json/);
  assert.match(yaml, /scripts\/release-public-build-inputs.json/);
  for (const [, action] of yaml.matchAll(/uses: (\S+)/g)) assert.match(action, /@[0-9a-f]{40}$/);
});
