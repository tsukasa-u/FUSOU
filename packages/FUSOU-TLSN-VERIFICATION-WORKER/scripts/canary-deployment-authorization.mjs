import {
  CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT,
  canaryExternalPackageVerificationReport,
  loadCanaryExternalPackageManifest,
} from "./canary-external-package.mjs";

export async function authorizeCanaryDeployment({
  manifestPath,
  environment = process.env,
  currentHead,
  now = new Date(),
} = {}) {
  const suppliedPath = manifestPath?.trim();
  if (!suppliedPath) {
    return {
      deployment_authorization: "DENIED",
      deployment_executed: false,
      external_package: {
        status: "ABSENT",
        ...canaryExternalPackageVerificationReport({
          status: "ABSENT",
          diagnostics: [{
            field: CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT,
            category: "ABSENCE",
            reason: "accepted external package manifest was not supplied",
          }],
        }),
      },
    };
  }

  try {
    const manifest = await loadCanaryExternalPackageManifest(suppliedPath, {
      environment,
      currentHead,
      now,
    });
    return {
      deployment_authorization: "AUTHORIZED",
      deployment_executed: false,
      external_package: {
        status: "VALID",
        ...canaryExternalPackageVerificationReport({ status: "VALID", manifest }),
      },
    };
  } catch (error) {
    return {
      deployment_authorization: "DENIED",
      deployment_executed: false,
      external_package: {
        status: "INVALID",
        ...canaryExternalPackageVerificationReport({
          status: "INVALID",
          diagnostics: Array.isArray(error?.diagnostics)
            ? error.diagnostics
            : [{
                field: CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT,
                category: "CONTENT",
                reason: "accepted external package validation failed",
              }],
        }),
      },
    };
  }
}

export function assertCanaryDeploymentAuthorized(authorization) {
  if (authorization?.deployment_authorization !== "AUTHORIZED"
    || authorization.external_package?.status !== "VALID"
    || authorization.external_package.verification?.acceptance !== "PASS"
    || authorization.external_package.verification?.readiness_eligible !== true) {
    throw new Error("Canary deployment authorization requires a VALID accepted external package");
  }
  return authorization;
}