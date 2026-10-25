const SHA = /^[0-9a-f]{40}$/;
export const TAG_WORKFLOW_PATH = ".github/workflows/tlsn-tag-validation.yml";

export function classifyReleaseTag(tag) {
  if (typeof tag !== "string") throw new Error("tag name is required");
  if (/^fusou-dev-[a-z0-9][a-z0-9._-]{0,100}$/.test(tag)) return "development";
  if (/^fusou-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) return "production";
  throw new Error("tag is outside the development/Production namespaces");
}

function assertSha(sha) {
  if (!SHA.test(sha ?? "")) throw new Error("full commit SHA is required");
  return sha;
}

export async function resolveTagCommit(github, repository, tag) {
  classifyReleaseTag(tag);
  const { data: ref } = await github.rest.git.getRef({ ...repository, ref: `tags/${tag}` });
  let object = ref.object;
  const seen = new Set();
  for (let depth = 0; depth < 8; depth += 1) {
    assertSha(object?.sha);
    if (object.type === "commit") return object.sha;
    if (object.type !== "tag" || seen.has(object.sha)) throw new Error("tag does not resolve to a commit");
    seen.add(object.sha);
    object = (await github.rest.git.getTag({ ...repository, tag_sha: object.sha })).data.object;
  }
  throw new Error("annotated tag nesting exceeds the resolution limit");
}

export async function evaluateReleaseRun({ github, repository, runId, trustedSha }) {
  assertSha(trustedSha);
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error("workflow run ID is required");
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...repository, run_id: runId });
  const fullName = `${repository.owner}/${repository.repo}`;
  if (run.repository?.full_name !== fullName || run.head_repository?.full_name !== fullName ||
      run.id !== runId || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 ||
      run.event !== "push" || run.path !== TAG_WORKFLOW_PATH ||
      run.status !== "completed" || run.conclusion !== "success") {
    throw new Error("successful same-repository tag-validation push run is required");
  }
  const tag = run.head_branch;
  const kind = classifyReleaseTag(tag);
  const sha = assertSha(run.head_sha);
  if (await resolveTagCommit(github, repository, tag) !== sha) throw new Error("tag moved after validation");
  const report = {
    schema_version: 2,
    tag,
    kind,
    commit_sha: sha,
    validation_run_id: runId,
    validation_run_attempt: run.run_attempt,
    coordinator_sha: trustedSha,
    main_sha: null,
    eligibility: "DEVELOPMENT_ONLY",
    status: "DEVELOPMENT_VALIDATED",
    release_status: "NOT_APPLICABLE",
    artifact_status: "NOT_CHECKED",
    deployment_status: "NOT_CHECKED",
    blockers: [],
    deployed: false,
    production_acceptance: "BLOCKED",
  };
  if (kind === "development") return report;
  const { data: main } = await github.rest.repos.getBranch({ ...repository, branch: "main" });
  const mainSha = assertSha(main.commit?.sha);
  const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
    ...repository, basehead: `${sha}...${mainSha}`,
  });
  if (!["ahead", "identical"].includes(comparison.status) || comparison.merge_base_commit?.sha !== sha) {
    throw new Error("Production tag commit is not in the observed main history");
  }
  // Never accept a tag's replacement workflow as proof of the trusted validation contract.
  const files = await Promise.all([sha, trustedSha].map(async (ref) =>
    (await github.rest.repos.getContent({ ...repository, path: TAG_WORKFLOW_PATH, ref })).data,
  ));
  if (files.some((file) => file.type !== "file" || !SHA.test(file.sha ?? "")) || files[0].sha !== files[1].sha) {
    throw new Error("tag validation workflow differs from the trusted coordinator revision");
  }
  if (await resolveTagCommit(github, repository, tag) !== sha) throw new Error("tag moved during eligibility verification");
  return {
    ...report,
    main_sha: mainSha,
    eligibility: "MAIN_HISTORY_VALIDATED",
    status: "PRODUCTION_ELIGIBLE",
    validation_workflow_blob_sha: files[0].sha,
    release_status: "BLOCKED_EXTERNAL_INPUTS",
    blockers: [
      "PRODUCTION_ENVIRONMENT_AND_CREDENTIAL_ISOLATION_NOT_OBSERVED",
      "APP_WORKER_RUNTIME_CONFIG_RELEASE_LINK_NOT_IMPLEMENTED",
      "PRODUCTION_SIGNER_AND_DEPLOYMENT_REGISTRATION_REQUIRED",
      "VERSIONED_PROTOCOL_DECISIONS_REQUIRED",
    ],
  };
}
