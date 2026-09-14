#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryDirectory = resolve(packageDirectory, "../..");
const defaultDataRoot = resolve(repositoryDirectory, "packages/FUSOU-PROXY-DATA");
const endpointSuffix = "@api_get_member@require_info";
const responsePrefix = Buffer.from("svdata=", "ascii");
const responsePaths = [
  ["api_data"],
  ["api_data", "api_basic"],
  ["api_data", "api_basic", "api_member_id"],
  ["api_data", "api_slot_item"],
  ["api_data", "api_unsetslot"],
  ["api_data", "api_kdock"],
  ["api_data", "api_useitem"],
  ["api_data", "api_furniture"],
  ["api_data", "api_extra_supply"],
  ["api_data", "api_oss_setting"],
  ["api_data", "api_skin_id"],
  ["api_data", "api_position_id"],
];

function dataRoot() {
  const configured = process.env.FUSOU_PROXY_DATA_PATH;
  return resolve(repositoryDirectory, configured ?? defaultDataRoot);
}

function fixtureKind(fileName) {
  if (fileName.endsWith(`Q${endpointSuffix}`)) return "Q";
  if (fileName.endsWith(`S${endpointSuffix}`)) return "S";
  return null;
}

function extractPayload(bytes, filePath) {
  const opening = bytes[0] === 0x2d && bytes[1] === 0x2d && bytes[2] === 0x2d
    ? (bytes[3] === 0x0d && bytes[4] === 0x0a ? 5 : bytes[3] === 0x0a ? 4 : -1)
    : -1;
  if (opening < 0) throw new Error(`${filePath}: missing metadata opening delimiter`);

  const closingStart = bytes.indexOf(Buffer.from("\n---"), opening);
  if (closingStart < 0) throw new Error(`${filePath}: missing metadata closing delimiter`);
  const delimiterEnd = closingStart + 4;
  const closingEnd = bytes[delimiterEnd] === 0x0d && bytes[delimiterEnd + 1] === 0x0a
    ? delimiterEnd + 2
    : bytes[delimiterEnd] === 0x0a
      ? delimiterEnd + 1
      : -1;
  if (closingEnd < 0) {
    throw new Error(`${filePath}: metadata closing delimiter is not newline terminated`);
  }
  return {
    metadataBytes: closingEnd,
    payload: bytes.subarray(closingEnd),
  };
}

function percentile(sortedValues, fraction) {
  const index = Math.max(0, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index];
}

function stats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    p999: percentile(sorted, 0.999),
    max: sorted.at(-1),
    mean: Number((sum / values.length).toFixed(2)),
    median: values.length % 2 === 0
      ? (sorted[values.length / 2 - 1] + sorted[values.length / 2]) / 2
      : sorted[Math.floor(values.length / 2)],
  };
}

function parseQuery(payload, filePath) {
  const query = new URLSearchParams(payload.toString("utf8"));
  const keys = [...query.keys()].sort();
  if (keys.join("\0") !== "api_token\0api_verno") {
    throw new Error(`${filePath}: unexpected query keys`);
  }
  return { keys };
}

function hasPath(value, path) {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object" || !(key in current)) return false;
    current = current[key];
  }
  return true;
}

function parseResponse(payload, filePath) {
  if (!payload.subarray(0, responsePrefix.length).equals(responsePrefix)) {
    throw new Error(`${filePath}: response does not start with svdata=`);
  }
  const jsonBytes = payload.subarray(responsePrefix.length);
  let value;
  try {
    value = JSON.parse(jsonBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${filePath}: invalid response JSON: ${error.message}`);
  }
  if (value.api_result !== 1) throw new Error(`${filePath}: api_result is not 1`);
  return {
    jsonBytes: jsonBytes.length,
    requiredPathPresence: Object.fromEntries(
      responsePaths.map((path) => [path.join("."), hasPath(value, path)]),
    ),
  };
}

function collectRecords(root) {
  const records = [];
  const epochNames = readdirSync(root).sort();
  for (const epoch of epochNames) {
    const epochPath = resolve(root, epoch);
    if (!statSync(epochPath).isDirectory()) continue;
    const kcsapiPath = resolve(epochPath, "kcsapi");
    let files;
    try {
      files = readdirSync(kcsapiPath).sort();
    } catch {
      continue;
    }
    for (const fileName of files) {
      const kind = fixtureKind(fileName);
      if (!kind) continue;
      const filePath = resolve(kcsapiPath, fileName);
      const bytes = readFileSync(filePath);
      const { metadataBytes, payload } = extractPayload(bytes, filePath);
      const record = {
        epoch,
        fileName,
        kind,
        fileBytes: bytes.length,
        metadataBytes,
        payloadBytes: payload.length,
      };
      if (kind === "Q") Object.assign(record, parseQuery(payload, filePath));
      if (kind === "S") Object.assign(record, parseResponse(payload, filePath));
      records.push(record);
    }
  }
  return records;
}

function sampleAt(records, payloadBytes) {
  const record = records.find((candidate) => candidate.payloadBytes === payloadBytes);
  return record ? { epoch: record.epoch, fileName: record.fileName } : null;
}

function summarizeRecords(records, kind, sizeKey) {
  const selected = records.filter((record) => record.kind === kind);
  const values = selected.map((record) => record[sizeKey]);
  const summary = stats(values);
  return {
    ...summary,
    samples: Object.fromEntries(
      [["p50", summary.p50], ["p95", summary.p95], ["p99", summary.p99], ["max", summary.max]]
        .map(([label, value]) => [label, sampleAt(selected, value)]),
    ),
  };
}

function run() {
  const root = dataRoot();
  const records = collectRecords(root);
  const requests = records.filter((record) => record.kind === "Q");
  const responses = records.filter((record) => record.kind === "S");
  const epochs = [...new Set(records.map((record) => record.epoch))];
  const perEpoch = Object.fromEntries(epochs.map((epoch) => {
    const qCount = requests.filter((record) => record.epoch === epoch).length;
    const sCount = responses.filter((record) => record.epoch === epoch).length;
    return [epoch, { requestCount: qCount, responseCount: sCount, ordinalPairingValid: qCount === sCount }];
  }));
  const requiredPathPresence = Object.fromEntries(responsePaths.map((path) => {
    const key = path.join(".");
    return [key, responses.filter((record) => record.requiredPathPresence[key]).length];
  }));
  const responseBody = summarizeRecords(records, "S", "payloadBytes");
  const responseJson = summarizeRecords(records, "S", "jsonBytes");
  const responseLimit = 16 * 1024 * 1024;

  console.log(JSON.stringify({
    benchmark: "require-info-fixture-statistics-v1",
    source: {
      path: root,
      fixtureSemantics: "metadata plus API body; HTTP status, headers, and TLS framing are absent",
      httpTranscriptSize: "NOT_ESTABLISHED",
    },
    counts: {
      epochs: epochs.length,
      requests: requests.length,
      responses: responses.length,
      matchingCounts: requests.length === responses.length,
    },
    perEpoch,
    metadataBytes: [...new Set(records.map((record) => record.metadataBytes))].sort((left, right) => left - right),
    request: {
      payloadBytes: summarizeRecords(records, "Q", "payloadBytes"),
      queryKeys: ["api_token", "api_verno"],
    },
    response: {
      fixtureBodyBytes: responseBody,
      jsonBodyBytesAfterSvdataPrefix: responseJson,
      svdataPrefixCount: responses.length,
      apiResultOneCount: responses.length,
      requiredPathPresence,
      responseLimitBytes: responseLimit,
      maxFixtureBodyHeadroomBytes: responseLimit - responseBody.max,
      maxJsonBodyHeadroomBytes: responseLimit - responseJson.max,
    },
    pairing: {
      method: "ordinal within each epoch; Q/S timestamps are not asserted equal",
      allEpochCountsMatch: Object.values(perEpoch).every((value) => value.ordinalPairingValid),
    },
    privacy: {
      valuesPrinted: false,
      tokensPrinted: false,
      responseBodiesPrinted: false,
    },
  }, null, 2));
}

run();