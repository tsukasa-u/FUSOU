import { pathToFileURL } from "node:url";
import { inspectRuntimeConfigR2Environment } from "./tlsn-runtime-config-r2-store.mjs";
import { RUNTIME_CONFIG_PRODUCTION_SIGNING_REGISTRATION } from "./tlsn-runtime-config-production-registration.mjs";

export function getTlsnRuntimeConfigPublisherReadiness(env = process.env) {
  const r2 = inspectRuntimeConfigR2Environment(env);
  const r2Configured = Object.values(r2).every((state) =>
    state === "PRESENT_FORMAT_VALID" || state === "PRESENT_UNVERIFIED");
  const checks = [
    { requirement: "Local manifest schema and publisher adapter", state: "IMPLEMENTED" },
    { requirement: "R2 account ID format", state: r2.account_id },
    { requirement: "R2 bucket name format", state: r2.bucket },
    { requirement: "R2 access key ID presence", state: r2.access_key_id },
    { requirement: "R2 secret access key presence", state: r2.secret_access_key },
    { requirement: "R2 configuration complete", state: r2Configured ? "PRESENT" : "INCOMPLETE" },
    {
      requirement: "Independent Production signer pin",
      state: RUNTIME_CONFIG_PRODUCTION_SIGNING_REGISTRATION.independent_signer_pin,
    },
    {
      requirement: "Production signer provider",
      state: RUNTIME_CONFIG_PRODUCTION_SIGNING_REGISTRATION.signer_provider,
    },
    { requirement: "Signer identity matches independent pin", state: "NOT_CHECKED" },
    { requirement: "Production signature generation and verification", state: "NOT_RUN" },
    { requirement: "Worker and authority publication inputs", state: "NOT_PROVIDED_TO_DIAGNOSTIC" },
    { requirement: "R2 adapter endpoint construction", state: "IMPLEMENTED_FROM_ACCOUNT_ID" },
    { requirement: "R2 credentials have sufficient bucket-scoped permissions", state: "NOT_CHECKED" },
    { requirement: "Live R2 read, write, and exact readback", state: "NOT_RUN" },
    { requirement: "Live R2 conditional create and pointer CAS", state: "NOT_RUN" },
    { requirement: "Server-side signed epoch monotonicity on the current manifest pointer", state: "IMPLEMENTED_WITH_CONDITIONAL_CAS" },
    { requirement: "Independent recovery authority if the server manifest pointer is lost", state: "NOT_REGISTERED" },
    {
      requirement: "Production manifest endpoint registration",
      state: RUNTIME_CONFIG_PRODUCTION_SIGNING_REGISTRATION.manifest_endpoint,
    },
    {
      requirement: "APP bootstrap signer root registration",
      state: RUNTIME_CONFIG_PRODUCTION_SIGNING_REGISTRATION.app_bootstrap_root,
    },
    { requirement: "Production publish authorization", state: "BLOCKED_EXTERNAL_INPUTS" },
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
