export type VerificationExecutionMode = "trigger" | "queue" | "direct" | "sync" | "invalid";

export type VerificationExecutionModeSelection =
  | { valid: true; mode: Exclude<VerificationExecutionMode, "invalid"> }
  | {
      valid: false;
      mode: "invalid";
      error: "unknown_production_execution_mode" | "unknown_test_execution_mode";
    };

export function resolveVerificationExecutionMode(input: {
  environment: string;
  deploymentRole?: string | undefined;
  productionExecutionMode?: string | undefined;
  executionMode?: string | undefined;
}): VerificationExecutionModeSelection {
  if (input.environment === "production" && input.deploymentRole === "production") {
    switch (input.productionExecutionMode) {
      case undefined:
      case "trigger":
        return { valid: true, mode: "trigger" };
      case "queue":
        return { valid: true, mode: "queue" };
      default:
        return {
          valid: false,
          mode: "invalid",
          error: "unknown_production_execution_mode",
        };
    }
  }

  if (input.environment === "production") {
    return { valid: true, mode: "trigger" };
  }

  if (input.environment === "test") {
    switch (input.executionMode) {
      case undefined:
        return { valid: true, mode: "sync" };
      case "trigger":
      case "queue":
      case "direct":
        return { valid: true, mode: input.executionMode };
      default:
        return {
          valid: false,
          mode: "invalid",
          error: "unknown_test_execution_mode",
        };
    }
  }

  if (input.executionMode === undefined) {
    return { valid: true, mode: "sync" };
  }
  if (input.executionMode === "trigger") {
    return { valid: true, mode: "trigger" };
  }

  return {
    valid: false,
    mode: "invalid",
    error: "unknown_test_execution_mode",
  };
}
