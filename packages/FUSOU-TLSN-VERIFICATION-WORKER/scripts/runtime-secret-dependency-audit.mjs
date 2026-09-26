#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT } from "./canary-runtime-attestation-key-registry.mjs";
import {
  CANARY_SECRET_INPUTS,
  EVIDENCE_WORKER_SECRET_CONTRACT,
  EVIDENCE_WORKER_SECRET_INPUTS,
  PRODUCTION_SECRET_INPUTS,
  PRODUCTION_WORKER_SECRET_CONTRACT,
  TEST_WORKER_SECRET_CONTRACT,
  TEST_WORKER_SECRET_INPUTS,
  WORKER_SECRET_CAPABILITIES,
  CANARY_WORKER_SECRET_CONTRACT,
} from "./deployment-contract.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const RUNTIME_SOURCE_FILES = ["src/index.ts", "src/direct_verifier.ts"];

const CLASSIFIED_SECRET_INPUTS = new Set([
  ...CANARY_SECRET_INPUTS,
  ...PRODUCTION_SECRET_INPUTS,
  ...EVIDENCE_WORKER_SECRET_INPUTS,
  ...TEST_WORKER_SECRET_INPUTS,
]);

const SECRET_NAME_PATTERN = /(?:SECRET|PRIVATE_KEY|AUTH_USERS|ACCESS_TOKEN|API_KEY|PASSWORD)/;
const SYNTHETIC_CONFIGURATION_INPUTS = new Set(["TLSN_REPLAY_AUTH_USERS"]);

function environmentPropertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))) {
    return node.argumentExpression.text;
  }
  return null;
}

function isEnvironmentHandleExpression(node, aliases) {
  if (ts.isIdentifier(node)) {
    return node.text === "env" || aliases.has(node.text);
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "env";
  }
  if (ts.isElementAccessExpression(node)) {
    return ts.isStringLiteral(node.argumentExpression)
      && node.argumentExpression.text === "env";
  }
  return false;
}

function isEnvironmentPropertyAccess(node, aliases) {
  const name = environmentPropertyName(node);
  if (!name || !/^TLSN_/.test(name)) return false;
  return isEnvironmentHandleExpression(node.expression, aliases);
}

function isSecretInputName(name) {
  return CLASSIFIED_SECRET_INPUTS.has(name)
    || (SECRET_NAME_PATTERN.test(name) && !SYNTHETIC_CONFIGURATION_INPUTS.has(name));
}

function functionNameForNode(node, sourceFile, parentFunctionName) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name?.getText(sourceFile) ?? `${sourceFile.fileName}:anonymous:${node.pos}`;
  }
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    if (node.name) return node.name.getText(sourceFile);
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent)) return parent.name.getText(sourceFile);
    if (ts.isPropertyAssignment(parent)) return parent.name.getText(sourceFile);
    return `${sourceFile.fileName}:anonymous:${node.pos}`;
  }
  return parentFunctionName;
}

function analyzeSource(fileName, source) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const functions = [];
  const functionByKey = new Map();
  const reads = [];

  function addFunction(node, name, parentFunctionName) {
    const key = `${fileName}:${name}:${node.pos}`;
    const model = {
      key,
      name,
      fileName,
      start: node.getStart(sourceFile),
      end: node.end,
      body: node.getText(sourceFile),
      reads: [],
      calls: new Set(),
      parentFunctionName,
    };
    functions.push(model);
    functionByKey.set(key, model);
    return model;
  }

  function addRead(node, name, activeFunction) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const read = {
      name,
      fileName,
      line: position.line + 1,
      functionName: activeFunction?.name ?? "<module>",
      functionKey: activeFunction?.key ?? null,
    };
    reads.push(read);
    activeFunction?.reads.push(read);
  }

  function bindingPropertyName(node) {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return null;
  }

  function registerEnvironmentBindings(node, aliases, activeFunction) {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    if (ts.isIdentifier(node.name)) {
      if (isEnvironmentHandleExpression(node.initializer, aliases)) aliases.add(node.name.text);
      return;
    }
    if (!ts.isObjectBindingPattern(node.name) || !isEnvironmentHandleExpression(node.initializer, aliases)) return;
    for (const element of node.name.elements) {
      if (!ts.isBindingElement(element)) continue;
      const propertyName = bindingPropertyName(element.propertyName ?? element.name);
      if (propertyName && isSecretInputName(propertyName)) addRead(element, propertyName, activeFunction);
    }
  }

  function visit(node, currentFunction, aliases) {
    let activeFunction = currentFunction;
    let activeAliases = aliases;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      activeFunction = addFunction(node, functionNameForNode(node, sourceFile, currentFunction?.name), currentFunction?.name);
      activeAliases = new Set(aliases);
    }

    registerEnvironmentBindings(node, activeAliases, activeFunction);
    const environmentName = environmentPropertyName(node);
    if (isEnvironmentPropertyAccess(node, activeAliases) && isSecretInputName(environmentName)) {
      addRead(node, environmentName, activeFunction);
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      activeFunction?.calls.add(node.expression.text);
    }

    ts.forEachChild(node, (child) => visit(child, activeFunction, activeAliases));
  }

  visit(sourceFile, null, new Set());
  return { sourceFile, functions, functionByKey, reads };
}

export function analyzeRuntimeSources(sources) {
  const analyses = Object.entries(sources).map(([fileName, source]) => analyzeSource(fileName, source));
  const functions = analyses.flatMap((analysis) => analysis.functions);
  const reads = analyses.flatMap((analysis) => analysis.reads);
  const functionsByName = new Map();
  for (const model of functions) {
    const entries = functionsByName.get(model.name) ?? [];
    entries.push(model);
    functionsByName.set(model.name, entries);
  }
  const callGraph = new Map(functions.map((model) => [model.key, new Set()]));
  for (const model of functions) {
    for (const calleeName of model.calls) {
      for (const callee of functionsByName.get(calleeName) ?? []) {
        callGraph.get(model.key).add(callee.key);
      }
    }
  }
  const calledNames = new Set(functions.flatMap((model) => [...model.calls]));
  return {
    analyses,
    functions,
    reads,
    functionsByName,
    callGraph,
    calledNames,
    names: new Set(reads.map((read) => read.name)),
  };
}

function capabilityDescriptors(value, path = [], output = []) {
  if (Array.isArray(value)) return output;
  if (value && Array.isArray(value.inputs)) {
    output.push({ path, ...value });
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    capabilityDescriptors(child, [...path, key], output);
  }
  return output;
}

function capabilitySecretNames(capabilities) {
  return new Set(capabilityDescriptors(capabilities).flatMap((descriptor) => descriptor.inputs));
}

function expectedSecretContract(profile) {
  if (profile === "canary") return CANARY_WORKER_SECRET_CONTRACT;
  if (profile === "evidence") return EVIDENCE_WORKER_SECRET_CONTRACT;
  if (profile === "test") return TEST_WORKER_SECRET_CONTRACT;
  if (profile === "production") return PRODUCTION_WORKER_SECRET_CONTRACT;
  throw new Error(`unsupported capability profile: ${profile}`);
}

function pathLabel(path) {
  return path.join("/");
}

function reachableFunctionKeys(model, startKey) {
  const reachable = new Set([startKey]);
  const pending = [startKey];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const callee of model.callGraph.get(current) ?? []) {
      if (reachable.has(callee)) continue;
      reachable.add(callee);
      pending.push(callee);
    }
  }
  return reachable;
}

function readerConsumerReachabilityWitness(model, readerName, consumerName) {
  const readers = model.functionsByName.get(readerName) ?? [];
  const consumers = model.functionsByName.get(consumerName) ?? [];
  for (const start of model.functions) {
    const reachable = reachableFunctionKeys(model, start.key);
    if (readers.some((reader) => reachable.has(reader.key)) && consumers.some((consumer) => reachable.has(consumer.key))) {
      return `${start.name} -> ${readerName} + ${consumerName}`;
    }
  }
  return null;
}

function assertWorkerScope(descriptor) {
  const [profile, worker, category, modeOrCapability] = descriptor.path;
  for (const name of descriptor.inputs) {
    if (profile === "canary") {
      assert.equal(name.startsWith("TLSN_CANARY_"), true, `${pathLabel(descriptor.path)} contains non-Canary secret ${name}`);
      assert.notEqual(name, CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT, `${pathLabel(descriptor.path)} may not receive the deployment-only attestation key`);
    } else if (profile === "production") {
      assert.equal(name.startsWith("TLSN_PRODUCTION_"), true, `${pathLabel(descriptor.path)} contains non-Production secret ${name}`);
    } else if (profile === "evidence" || profile === "test") {
      assert.equal(name.startsWith("TLSN_CANARY_"), false, `${pathLabel(descriptor.path)} contains Canary secret ${name}`);
      assert.equal(name.startsWith("TLSN_PRODUCTION_"), false, `${pathLabel(descriptor.path)} contains Production secret ${name}`);
    }
  }

  if (profile !== "test" || category !== "modes") return;
  const mode = modeOrCapability;
  const modePattern = {
    sync: null,
    trigger: /TRIGGER_/,
    queue: /QUEUE_CALLBACK_SECRET$/,
    direct: /DIRECT_CALLBACK_SECRET$/,
  }[mode];
  if (!modePattern) {
    assert.deepEqual(descriptor.inputs, [], `${pathLabel(descriptor.path)} contains mode-specific secrets`);
    return;
  }
  for (const name of descriptor.inputs) {
    assert.match(name, modePattern, `${pathLabel(descriptor.path)} contains secret for another execution mode: ${name}`);
  }
}

function assertConsumerEvidence(descriptor, model) {
  const consumerEvidence = descriptor.runtimeConsumerEvidence ?? {};
  assert.deepEqual(
    [...new Set(descriptor.runtimeConsumers)].sort(),
    Object.keys(consumerEvidence).sort(),
    `${pathLabel(descriptor.path)} runtime consumer declarations must match evidence`,
  );
  for (const consumer of descriptor.runtimeConsumers) {
    const candidates = model.functionsByName.get(consumer) ?? [];
    assert.ok(candidates.length > 0, `${pathLabel(descriptor.path)} references missing runtime consumer ${consumer}`);
    const evidence = consumerEvidence[consumer];
    if (evidence) {
      assert.ok(
        candidates.some((candidate) => candidate.body.includes(evidence)),
        `${pathLabel(descriptor.path)} consumer ${consumer} no longer contains ${evidence}`,
      );
    }
    assert.equal(
      model.calledNames.has(consumer) || consumer === "readConfig" || consumer === "authenticateRequest",
      true,
      `${pathLabel(descriptor.path)} runtime consumer ${consumer} is not reachable from a call site`,
    );
  }
}

function assertReaderConsumerReachability(descriptor, model) {
  const readerConsumers = descriptor.runtimeReaderConsumers ?? Object.fromEntries(
    descriptor.runtimeReaders.map((reader) => [reader, descriptor.runtimeConsumers]),
  );
  assert.deepEqual(
    Object.keys(readerConsumers).sort(),
    [...new Set(descriptor.runtimeReaders)].sort(),
    `${pathLabel(descriptor.path)} reader/consumer mapping must cover exactly the declared readers`,
  );
  assert.deepEqual(
    [...new Set(Object.values(readerConsumers).flat())].sort(),
    [...new Set(descriptor.runtimeConsumers)].sort(),
    `${pathLabel(descriptor.path)} reader/consumer mapping must cover exactly the declared consumers`,
  );
  for (const reader of descriptor.runtimeReaders) {
    for (const consumer of readerConsumers[reader] ?? []) {
      assert.ok(
        readerConsumerReachabilityWitness(model, reader, consumer),
        `${pathLabel(descriptor.path)} has no static call-graph path from runtime reader ${reader} to consumer ${consumer}`,
      );
    }
  }
}

function assertReaderEvidence(descriptor, model) {
  for (const reader of descriptor.runtimeReaders) {
    const candidates = model.functionsByName.get(reader) ?? [];
    assert.ok(candidates.length > 0, `${pathLabel(descriptor.path)} references missing runtime reader ${reader}`);
    assert.equal(
      candidates.some((candidate) => candidate.reads.some((read) => descriptor.inputs.includes(read.name))),
      true,
      `${pathLabel(descriptor.path)} runtime readers no longer read a declared Secret`,
    );
  }
  for (const name of descriptor.inputs) {
    assert.equal(
      model.reads.some((read) => read.name === name && descriptor.runtimeReaders.includes(read.functionName)),
      true,
      `${pathLabel(descriptor.path)} declares stale runtime Secret ${name}`,
    );
  }
}

function assertCapabilityContract(profile, capabilities) {
  const derived = {};
  for (const [worker, value] of Object.entries(capabilities)) {
    if (profile === "test") {
      if (worker === "main") {
        derived.main = Object.fromEntries(Object.entries(value.modes).map(([mode, modeCapabilities]) => [
          mode,
          [...new Set([
            ...capabilityDescriptors(value.always).flatMap((descriptor) => descriptor.inputs),
            ...capabilityDescriptors(modeCapabilities).flatMap((descriptor) => descriptor.inputs),
          ])],
        ]));
      } else {
        derived.verifier = { direct: [...capabilitySecretNames(value.direct)] };
      }
    } else {
      derived[worker] = [...capabilitySecretNames(value)];
    }
  }
  assert.deepEqual(derived, expectedSecretContract(profile), `${profile} deployment bundle drifted from capabilities`);
}

export function auditRuntimeSecretDependencies({ sources, capabilities = WORKER_SECRET_CAPABILITIES } = {}) {
  const model = analyzeRuntimeSources(sources);
  const descriptors = capabilityDescriptors(capabilities);
  const declaredNames = capabilitySecretNames(capabilities);

  assert.ok(descriptors.length > 0, "runtime Secret capability contract is empty");
  assert.equal(
    declaredNames.has(CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_INPUT),
    false,
    "Runtime Attestation private key must remain deployment-side only",
  );
  for (const descriptor of descriptors) {
    assert.ok(descriptor.inputs.length > 0, `${pathLabel(descriptor.path)} has no Secret inputs`);
    assert.ok(descriptor.runtimeReaders.length > 0, `${pathLabel(descriptor.path)} has no runtime readers`);
    assert.ok(descriptor.runtimeConsumers.length > 0, `${pathLabel(descriptor.path)} has no runtime consumers`);
    assertWorkerScope(descriptor);
    assertReaderEvidence(descriptor, model);
    assertConsumerEvidence(descriptor, model);
    assertReaderConsumerReachability(descriptor, model);
    for (const name of descriptor.inputs) {
      assert.equal(CLASSIFIED_SECRET_INPUTS.has(name), true, `${pathLabel(descriptor.path)} uses unclassified Secret ${name}`);
    }
  }

  for (const read of model.reads) {
    const matchingDescriptors = descriptors.filter((descriptor) => (
      descriptor.inputs.includes(read.name) && descriptor.runtimeReaders.includes(read.functionName)
    ));
    assert.ok(
      matchingDescriptors.length > 0,
      `runtime Secret read ${read.name} at ${read.fileName}:${read.line} has no declared runtime reader`,
    );
  }

  for (const profile of ["canary", "evidence", "test", "production"]) {
    assertCapabilityContract(profile, capabilities[profile]);
  }

  return {
    declaredNames,
    runtimeReads: model.reads,
    descriptors,
  };
}

export async function loadRuntimeSources() {
  return Object.fromEntries(await Promise.all(
    RUNTIME_SOURCE_FILES.map(async (fileName) => [fileName, await readFile(resolve(packageDirectory, fileName), "utf8")]),
  ));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  auditRuntimeSecretDependencies({ sources: await loadRuntimeSources() });
  console.log(`runtime Secret dependency audit passed (${RUNTIME_SOURCE_FILES.join(", ")})`);
}