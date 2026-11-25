import assert from "node:assert/strict";
import test from "node:test";
import { resolveVerificationExecutionMode } from "../src/execution-mode.ts";

test("Production role defaults to Trigger and can explicitly select Queue", () => {
  assert.deepEqual(resolveVerificationExecutionMode({
    environment: "production",
    deploymentRole: "production",
  }), { valid: true, mode: "trigger" });
  assert.deepEqual(resolveVerificationExecutionMode({
    environment: "production",
    deploymentRole: "production",
    productionExecutionMode: "trigger",
  }), { valid: true, mode: "trigger" });
  assert.deepEqual(resolveVerificationExecutionMode({
    environment: "production",
    deploymentRole: "production",
    productionExecutionMode: "queue",
  }), { valid: true, mode: "queue" });
});

test("unknown Production modes fail closed without selecting another executor", () => {
  assert.deepEqual(resolveVerificationExecutionMode({
    environment: "production",
    deploymentRole: "production",
    productionExecutionMode: "direct",
  }), {
    valid: false,
    mode: "invalid",
    error: "unknown_production_execution_mode",
  });
});

test("Canary and existing test execution selection remain independent", () => {
  assert.deepEqual(resolveVerificationExecutionMode({
    environment: "production",
    deploymentRole: "canary",
    productionExecutionMode: "queue",
  }), { valid: true, mode: "trigger" });
  assert.deepEqual(resolveVerificationExecutionMode({
    environment: "test",
    executionMode: "queue",
  }), { valid: true, mode: "queue" });
  assert.deepEqual(resolveVerificationExecutionMode({
    environment: "test",
    executionMode: "trigger",
  }), { valid: true, mode: "trigger" });
  assert.deepEqual(resolveVerificationExecutionMode({
    environment: "test",
    executionMode: "direct",
  }), { valid: true, mode: "direct" });
  assert.deepEqual(resolveVerificationExecutionMode({
    environment: "test",
  }), { valid: true, mode: "sync" });
});

test("unknown test execution mode is rejected instead of falling back to sync", () => {
  assert.deepEqual(resolveVerificationExecutionMode({
    environment: "test",
    executionMode: "unknown",
  }), {
    valid: false,
    mode: "invalid",
    error: "unknown_test_execution_mode",
  });
});
