import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyReleaseTag, evaluateReleaseRun, resolveTagCommit, TAG_WORKFLOW_PATH } from "./release-eligibility.mjs";

const sha = "a".repeat(40);
const trustedSha = "b".repeat(40);
const repository = { owner: "tsukasa-u", repo: "FUSOU" };
function fixture(tag = "fusou-v0.6.0") {
  const calls = [];
  const state = {
    run: { repository: { full_name: "tsukasa-u/FUSOU" }, head_repository: { full_name: "tsukasa-u/FUSOU" },
      event: "push", path: TAG_WORKFLOW_PATH, status: "completed", conclusion: "success",
      head_branch: tag, head_sha: sha },
    object: { type: "commit", sha },
    comparison: { status: "ahead", merge_base_commit: { sha } },
    content: { type: "file", sha: "c".repeat(40) },
  };
  const api = (name, fn) => async (args) => { calls.push([name, args]); return { data: fn(args) }; };
  const github = { rest: {
    actions: { getWorkflowRun: api("run", () => state.run) },
    git: { getRef: api("ref", () => ({ object: state.object })),
      getTag: api("tag", () => ({ object: { type: "commit", sha } })) },
    repos: { getBranch: api("main", () => ({ commit: { sha: trustedSha } })),
      compareCommitsWithBasehead: api("compare", () => state.comparison),
      getContent: api("content", () => state.content) },
  } };
  return { state, calls, github, options: { github, repository, trustedSha, runId: 1 } };
}

test("development namespace accepts candidate tags without a main ancestry requirement", async () => {
  const f = fixture("fusou-dev-v0.6.0-candidate.1");
  const report = await evaluateReleaseRun(f.options);
  assert.equal(report.commit_sha, sha);
  assert.equal(report.eligibility, "DEVELOPMENT_ONLY");
  assert.equal(report.deployed, false);
  assert.equal(f.calls.some(([name]) => name === "main"), false);
});
test("only stable existing fusou-v semver names select Production", () => {
  assert.equal(classifyReleaseTag("fusou-v0.5.0"), "production");
  for (const tag of ["fusou-v01.0.0", "fusou-v1.0.0-rc.1", "fusou-datasets-v0.2.0", "main", "../main", "fusou-dev-", null]) {
    assert.throws(() => classifyReleaseTag(tag));
  }
});
test("Production binds exact SHA, main comparison, workflow bytes and explicit unresolved setup", async () => {
  const f = fixture();
  const report = await evaluateReleaseRun(f.options);
  assert.equal(report.commit_sha, sha);
  assert.equal(report.main_sha, trustedSha);
  assert.equal(report.status, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(report.worker_version, null);
  assert.deepEqual(report.artifact_hashes, []);
  assert.ok(report.blockers.length);
  assert.equal(f.calls.find(([name]) => name === "compare")[1].basehead, `${sha}...${trustedSha}`);
});
test("Production rejects unrelated, behind or unverifiable main history", async () => {
  for (const status of ["behind", "diverged", undefined]) {
    const f = fixture();
    f.state.comparison.status = status;
    await assert.rejects(evaluateReleaseRun(f.options), /main history/);
  }
  const f = fixture();
  f.state.comparison.merge_base_commit.sha = trustedSha;
  await assert.rejects(evaluateReleaseRun(f.options), /main history/);
});
test("unsuccessful, foreign, branch and replacement-workflow runs cannot qualify", async () => {
  for (const change of [
    { conclusion: "failure" }, { status: "in_progress" }, { event: "workflow_dispatch" },
    { path: "other.yml" }, { head_branch: "main" }, { head_branch: null }, { head_branch: undefined }, { head_sha: "abc" },
    { repository: { full_name: "other/repo" } }, { head_repository: { full_name: "other/repo" } },
  ]) {
    const f = fixture();
    Object.assign(f.state.run, change);
    await assert.rejects(evaluateReleaseRun(f.options));
  }
});
test("missing API evidence and tag movement are explicit failures", async () => {
  const f = fixture();
  f.state.object.sha = trustedSha;
  await assert.rejects(evaluateReleaseRun(f.options), /tag moved/);
  const unavailable = fixture();
  unavailable.github.rest.repos.getBranch = async () => { throw new Error("main unavailable"); };
  await assert.rejects(evaluateReleaseRun(unavailable.options), /main unavailable/);
});
test("annotated tags resolve to the commit and cycles/noncommit objects reject", async () => {
  const f = fixture();
  f.state.object = { type: "tag", sha: trustedSha };
  assert.equal(await resolveTagCommit(f.github, repository, "fusou-v0.6.0"), sha);
  f.github.rest.git.getTag = async () => ({ data: { object: f.state.object } });
  await assert.rejects(resolveTagCommit(f.github, repository, "fusou-v0.6.0"), /resolve/);
  f.state.object.type = "tree";
  await assert.rejects(resolveTagCommit(f.github, repository, "fusou-v0.6.0"), /resolve/);
});
test("workflow replacement and a race after main verification reject", async () => {
  const f = fixture();
  f.github.rest.repos.getContent = async ({ ref }) => ({ data: { type: "file", sha: ref } });
  await assert.rejects(evaluateReleaseRun(f.options), /differs/);
  const raced = fixture();
  raced.github.rest.repos.getContent = async () => {
    raced.state.object = { type: "commit", sha: trustedSha };
    return { data: raced.state.content };
  };
  await assert.rejects(evaluateReleaseRun(raced.options), /tag moved during/);
});
test("missing main commit or comparison evidence cannot produce release eligibility", async () => {
  const f = fixture();
  f.github.rest.repos.getBranch = async () => ({ data: { commit: {} } });
  await assert.rejects(evaluateReleaseRun(f.options), /full commit SHA/);
  const missingBase = fixture();
  missingBase.state.comparison = { status: "ahead" };
  await assert.rejects(evaluateReleaseRun(missingBase.options), /main history/);
});
test("even a tag at main remains blocked without linked release and bootstrap evidence", async () => {
  const f = fixture();
  f.state.object.sha = trustedSha;
  f.state.run.head_sha = trustedSha;
  f.state.comparison = { status: "identical", merge_base_commit: { sha: trustedSha } };
  const report = await evaluateReleaseRun(f.options);
  assert.equal(report.commit_sha, report.main_sha);
  assert.equal(report.eligibility, "MAIN_HISTORY_VALIDATED");
  assert.equal(report.status, "BLOCKED_EXTERNAL_INPUTS");
  assert.equal(report.deployed, false);
  assert.equal(report.production_acceptance, "BLOCKED");
});
