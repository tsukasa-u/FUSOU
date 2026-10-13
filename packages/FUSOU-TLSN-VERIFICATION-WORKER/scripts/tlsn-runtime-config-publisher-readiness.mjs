import { pathToFileURL } from "node:url";
import { inspectRuntimeConfigR2Environment } from "./tlsn-runtime-config-r2-store.mjs";

export function getTlsnRuntimeConfigPublisherReadiness(env = process.env) {
  const r2 = inspectRuntimeConfigR2Environment(env);
  const checks = [
    { requirement: "R2 adapter implementation", state: "IMPLEMENTED" },
    { requirement: "R2 account ID", state: r2.account_id },
    { requirement: "R2 bucket name", state: r2.bucket },
    { requirement: "R2 access key ID", state: r2.access_key_id },
    { requirement: "R2 secret access key", state: r2.secret_access_key },
    { requirement: "Production Runtime Config signing root", state: "NOT_REGISTERED" },
    { requirement: "Production signing provider", state: "NOT_CONFIGURED" },
    { requirement: "Worker and authority publication inputs", state: "NOT_PROVIDED_TO_DIAGNOSTIC" },
    { requirement: "Live R2 permissions and readback", state: "NOT_TESTED" },
    { requirement: "Live conditional pointer CAS", state: "NOT_TESTED" },
  ];
  return Object.freeze({
    schema_version: 1,
    readiness: "BLOCKED_EXTERNAL_INPUTS",
    production_publish_allowed: false,
    network_access_performed: false,
    signing_performed: false,
    checks: Object.freeze(checks.map((check) => Object.freeze(check))),
  });
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  process.stdout.write(`${JSON.stringify(getTlsnRuntimeConfigPublisherReadiness(), null, 2)}\n`);
}
