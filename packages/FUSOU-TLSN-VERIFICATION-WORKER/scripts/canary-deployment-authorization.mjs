import {
  CANARY_DEPLOYMENT_MANIFEST_INPUT,
  canaryDeploymentManifestVerificationReport,
  loadCanaryDeploymentManifest,
} from "./canary-deployment-manifest.mjs";

export async function authorizeCanaryDeployment({
  manifestPath,
  environment = process.env,
  currentHead,
  now = new Date(),
  preflightStatus = "NOT_RUN",
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