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
  assert.match(yaml, /ref: refs\/heads\/main/);
  assert.match(yaml, /persist-credentials: false/);
  assert.match(yaml, /actions: read/);
  assert.match(yaml, /contents: read/);
  assert.match(yaml, /core\.setFailed/);
  assert.match(yaml, /if: always\(\)/);
  assert.doesNotMatch(yaml, /secrets\.|id-token:|: write|environment:|download-artifact|ref:.*head_sha/);
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
