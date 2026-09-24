import { readFile } from "node:fs/promises";
import {
  CANARY_DEPLOYMENT_MANIFEST_INPUT,
  canaryDeploymentManifestVerificationReport,
  loadCanaryDeploymentManifest,
} from "./canary-deployment-manifest.mjs";

async function readPreflightReport(reportPath) {
  const raw = await readFile(reportPath, "utf8");
  const report = JSON.parse(raw);
  if (!report || typeof report !== "object") throw new Error("production preflight report is invalid");
  if (
    report.schema_version !== 2
    || report.environment !== "production"
    || report.deployment_role !== "canary"
    || report.status !== "PASS"
    || report.failure_count !== 0
    || !Array.isArray(report.failures)
    || report.failures.length !== 0
    || !report.checks
    || typeof report.checks !== "object"
    || Object.values(report.checks).some((value) => value !== true)
  ) {
    throw new Error("production preflight report is not a passing Canary report");
  }
  return report;
}

export async function authorizeCanaryDeployment({
  manifestPath,
  environment = process.env,
  currentHead,
  now = new Date(),
  preflightReportPath,
} = {}) {
  const suppliedPath = manifestPath?.trim();
  if (!suppliedPath) {
    return {
      deployment_authorization: "DENIED",
      deployment_executed: false,
      deployment_manifest: {
        status: "ABSENT",
        ...canaryDeploymentManifestVerificationReport({
          status: "ABSENT",
          diagnostics: [{
            field: CANARY_DEPLOYMENT_MANIFEST_INPUT,
            category: "ABSENCE",
            reason: "Canary deployment manifest was not supplied",
          }],
        }),
      },
    };
  }

  try {
    const manifest = await loadCanaryDeploymentManifest(suppliedPath, {
      environment,
      currentHead,
      now,
    });
    let preflightStatus = "NOT_RUN";
    if (preflightReportPath?.trim()) {
      try {
        await readPreflightReport(preflightReportPath.trim());
        preflightStatus = "PASS";
      } catch {
        preflightStatus = "FAIL";
      }
    }
    return {
      deployment_authorization: preflightStatus === "PASS" ? "AUTHORIZED" : "PREFLIGHT_REQUIRED",
      deployment_executed: false,
      deployment_manifest: {
        status: "VALID",
        ...canaryDeploymentManifestVerificationReport({ status: "VALID", manifest, preflightStatus }),
      },
    };
  } catch (error) {
    return {
      deployment_authorization: "DENIED",
      deployment_executed: false,
      deployment_manifest: {
        status: "INVALID",
        ...canaryDeploymentManifestVerificationReport({
          status: "INVALID",
          diagnostics: Array.isArray(error?.diagnostics)
            ? error.diagnostics
            : [{
                field: CANARY_DEPLOYMENT_MANIFEST_INPUT,
                category: "CONTENT",
                reason: "Canary deployment manifest validation failed",
              }],
        }),
      },
    };
  }
}

export function assertCanaryDeploymentAuthorized(authorization) {
  if (authorization?.deployment_authorization !== "AUTHORIZED"
    || authorization.deployment_manifest?.status !== "VALID"
    || authorization.deployment_manifest.verification?.preconditions !== "PASS"
    || authorization.deployment_manifest.verification?.deployment_eligible !== true) {
    throw new Error("Canary deployment authorization requires a VALID deployment manifest and PASS production preflight");
  }
  return authorization;
}