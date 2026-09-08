import assert from "node:assert/strict";
import { parseExpectedIdentityChanges } from "./previous-deployment-contract.mjs";

assert.deepEqual(
  [...parseExpectedIdentityChanges('{"schema_version":1,"allowed_change_fields":["deployment_id","git_commit_sha"]}')].sort(),
  ["deployment_id", "git_commit_sha"],
);
assert.throws(() => parseExpectedIdentityChanges('["git_commit_sha"]'), /versioned object schema/);
assert.throws(() => parseExpectedIdentityChanges('{"schema_version":1,"allowed_change_fields":["verifier_key_id","verifier_key_id"]}'), /duplicate/);
assert.throws(() => parseExpectedIdentityChanges('{"schema_version":1,"allowed_change_fields":["profile_sha256"],"reason":"unexpected"}'), /versioned object schema/);
assert.throws(() => parseExpectedIdentityChanges('{"schema_version":1,"allowed_change_fields":["unknown"]}'), /unsupported/);

console.log("[tlsn-previous-deployment-contract] strict versioned change parser OK");