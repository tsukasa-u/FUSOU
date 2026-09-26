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
const RUNTIME_SOURCE_FILES = ["src/index.ts", "src/direct_verifier.ts", "src/verification_jobs.ts"];

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
      callSites: [],
      variables: [],
      objectProperties: [],
      propertyAccesses: [],
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

  function collectSecretNames(node, aliases) {
    const names = new Set();
    function collect(child) {
      const name = environmentPropertyName(child);
      if (isEnvironmentPropertyAccess(child, aliases) && isSecretInputName(name)) names.add(name);
      ts.forEachChild(child, collect);
    }
    collect(node);
    return names;
  }

  function visit(node, currentFunction, aliases) {
    let activeFunction = currentFunction;
    let activeAliases = aliases;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      activeFunction = addFunction(node, functionNameForNode(node, sourceFile, currentFunction?.name), currentFunction?.name);
      activeAliases = new Set(aliases);
    }

    registerEnvironmentBindings(node, activeAliases, activeFunction);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && activeFunction) {
      activeFunction.variables.push({
        name: node.name.text,
        initializer: node.initializer.getText(sourceFile),
        secretNames: collectSecretNames(node.initializer, activeAliases),
      });
    }
    const environmentName = environmentPropertyName(node);
    if (isEnvironmentPropertyAccess(node, activeAliases) && isSecretInputName(environmentName)) {
      addRead(node, environmentName, activeFunction);
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      activeFunction?.calls.add(node.expression.text);
      activeFunction?.callSites.push({
        calleeName: node.expression.text,
        arguments: node.arguments.map((argument) => argument.getText(sourceFile)),
      });
    }

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      activeFunction?.propertyAccesses.push({
        objectName: node.expression.text,
        propertyName: node.name.text,
      });
    }

    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const propertyName = ts.isPropertyAssignment(node)
        ? bindingPropertyName(node.name)
        : node.name.text;
      if (propertyName) {
        activeFunction?.objectProperties.push({
          propertyName,
          initializer: ts.isPropertyAssignment(node) ? node.initializer.getText(sourceFile) : node.name.text,
        });
      }
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

function provenanceEntries(descriptor) {
  const readerConsumers = descriptor.runtimeReaderConsumers;
  assert.ok(readerConsumers && typeof readerConsumers === "object", `${pathLabel(descriptor.path)} requires structured reader provenance`);
  assert.deepEqual(
    Object.keys(readerConsumers).sort(),
    [...new Set(descriptor.runtimeReaders)].sort(),
    `${pathLabel(descriptor.path)} reader provenance must cover exactly the declared readers`,
  );
  const entries = [];
  for (const reader of descriptor.runtimeReaders) {
    assert.ok(Array.isArray(readerConsumers[reader]), `${pathLabel(descriptor.path)} reader ${reader} provenance must be an array`);
    for (const entry of readerConsumers[reader]) {
      assert.equal(typeof entry.input, "string", `${pathLabel(descriptor.path)} reader ${reader} provenance is missing input`);
      assert.ok(Array.isArray(entry.consumers) && entry.consumers.length > 0, `${pathLabel(descriptor.path)} reader ${reader} provenance has no consumers`);
      entries.push({ reader, ...entry });
    }
  }
  assert.deepEqual(
    [...new Set(entries.map((entry) => entry.input))].sort(),
    [...new Set(descriptor.inputs)].sort(),
    `${pathLabel(descriptor.path)} reader provenance must cover exactly the declared Secret inputs`,
  );
  assert.deepEqual(
    [...new Set(entries.flatMap((entry) => entry.consumers))].sort(),
    [...new Set(descriptor.runtimeConsumers)].sort(),
    `${pathLabel(descriptor.path)} reader provenance must cover exactly the declared consumers`,
  );
  return entries;
}

function functionCandidates(model, name) {
  return model.functionsByName.get(name) ?? [];
}

function hasConfigPropertyProvenance(reader, entry) {
  const sourceVariables = reader.variables.filter((variable) => variable.secretNames.has(entry.input));
  const sourceProperty = entry.sourceProperty;
  const decodedProperty = entry.property;
  if (!sourceProperty || !decodedProperty || sourceVariables.length === 0) return false;
  const configInput = reader.objectProperties.some((property) => (
    property.propertyName === sourceProperty && sourceVariables.some((variable) => property.initializer.includes(variable.name))
  ));
  const decodedVariable = reader.variables.some((variable) => (
    variable.name === decodedProperty && variable.initializer.includes(`parsed.data.${sourceProperty}`)
  ));
  const returnedProperty = reader.objectProperties.some((property) => property.propertyName === decodedProperty);
  return configInput && decodedVariable && returnedProperty;
}

function hasValuePropertyProvenance(reader, consumer, entry) {
  if (!entry.value || !entry.property) return false;
  const sourcedValue = reader.variables.some((variable) => (
    variable.name === entry.value && variable.secretNames.has(entry.input)
  ));
  const returnedProperty = reader.objectProperties.some((property) => (
    property.propertyName === entry.property && property.initializer.includes(entry.value)
  ));
  const consumedProperty = consumer.propertyAccesses.some((access) => (
    access.objectName === "config" && access.propertyName === entry.property
  ));
  return sourcedValue && returnedProperty && consumedProperty;
}

function hasCallProvenance(reader, consumer, entry) {
  if (!entry.value || !entry.downstream) return false;
  const sourcedValue = consumer.variables.some((variable) => (
    variable.name === entry.value && variable.initializer.includes(`${reader.name}(`)
  ));
  const downstreamCall = consumer.callSites.some((call) => (
    call.calleeName === entry.downstream && call.arguments.includes(entry.value)
  ));
  return sourcedValue && downstreamCall;
}

function hasDirectProvenance(reader, consumer, entry) {
  return reader.reads.some((read) => read.name === entry.input)
    && consumer.reads.some((read) => read.name === entry.input);
}

function assertReaderConsumerProvenance(descriptor, model) {
  const entries = provenanceEntries(descriptor);
  for (const entry of entries) {
    const readers = functionCandidates(model, entry.reader);
    assert.ok(readers.length > 0, `${pathLabel(descriptor.path)} references missing runtime reader ${entry.reader}`);
    for (const consumerName of entry.consumers) {
      const consumers = functionCandidates(model, consumerName);
      assert.ok(consumers.length > 0, `${pathLabel(descriptor.path)} references missing runtime consumer ${consumerName}`);
      const provenanceKind = entry.kind ?? (entry.property ? "config" : "call");
      const proven = readers.some((reader) => consumers.some((consumer) => {
        if (provenanceKind === "config") return hasConfigPropertyProvenance(reader, entry)
          && consumer.propertyAccesses.some((access) => access.objectName === "config" && access.propertyName === entry.property);
        if (provenanceKind === "value") return hasValuePropertyProvenance(reader, consumer, entry);
        if (provenanceKind === "direct") return hasDirectProvenance(reader, consumer, entry);
        return hasCallProvenance(reader, consumer, entry);
      }));
      assert.ok(
        proven,
        `${pathLabel(descriptor.path)} has no Secret-to-consumer provenance for ${entry.input}: ${entry.reader} -> ${consumerName}`,
      );
      if (entry.downstream) {
        assert.ok(
          functionCandidates(model, entry.downstream).length > 0,
          `${pathLabel(descriptor.path)} references missing downstream runtime function ${entry.downstream}`,
        );
      }
    }
  }
}

function assertDirectVerifierProvenance(descriptor, model) {
  if (!descriptor.inputs.some((input) => input.endsWith("DIRECT_CALLBACK_SECRET"))) return;
  const directVerifierFunctions = model.functions.filter((candidate) => candidate.fileName.endsWith("src/direct_verifier.ts"));
  const directSecretHandlers = directVerifierFunctions.filter((candidate) => candidate.body.includes("directCallbackSecret(c.env)"));
  assert.ok(
    directVerifierFunctions.some((handler) => handler.callSites.some((call) => call.calleeName === "processVerificationCompletion"))
    && directSecretHandlers.some((handler) => (
      handler.variables.some((variable) => (
        variable.name === "callbackSecret" && variable.initializer.includes("directCallbackSecret(c.env)")
      ))
      && handler.callSites.some((call) => (
        call.calleeName === "verifyInternalRequest" && call.arguments.includes("callbackSecret")
      ))
    )),
    `${pathLabel(descriptor.path)} direct verifier must preserve directCallbackSecret(c.env) -> verifyInternalRequest callback dataflow`,
  );
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
    assertReaderConsumerProvenance(descriptor, model);
    assertDirectVerifierProvenance(descriptor, model);
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