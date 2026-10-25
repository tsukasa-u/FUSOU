// scripts/rebuild-all-snapshots.ts
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execSync } from "node:child_process";

// ../fusou-compaction-core/dist/avro.js
var OcfHeaderError = class extends Error {
  code = "CORRUPT_AVRO";
  constructor(message) {
    super(message);
    this.name = "OcfHeaderError";
  }
};
var AvroOcfError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "AvroOcfError";
  }
};
var OCF_MAGIC = Uint8Array.of(79, 98, 106, 1);
var OCF_SYNC_MARKER_LENGTH = 16;
var MAX_METADATA_ENTRIES = 4096;
function fail(message) {
  throw new AvroOcfError("CORRUPT_AVRO", message);
}
function readLong(bytes, cursor) {
  let raw = 0n;
  for (let index = 0; index < 10; index += 1) {
    const byte = bytes[cursor.offset];
    if (byte === void 0) {
      throw new OcfHeaderError("Avro integer is truncated");
    }
    cursor.offset += 1;
    raw |= BigInt(byte & 127) << BigInt(index * 7);
    if ((byte & 128) === 0) {
      const decoded = raw % 2n === 0n ? raw / 2n : -(raw + 1n) / 2n;
      const value = Number(decoded);
      if (!Number.isSafeInteger(value)) {
        throw new OcfHeaderError("Avro integer is outside the safe range");
      }
      return value;
    }
  }
  throw new OcfHeaderError("Avro integer is malformed");
}
function readDataLong(bytes, cursor) {
  try {
    return readLong(bytes, cursor);
  } catch (error) {
    if (error instanceof OcfHeaderError) {
      return fail(error.message);
    }
    throw error;
  }
}
function readBytes(bytes, cursor) {
  const length = readLong(bytes, cursor);
  if (length < 0 || !Number.isSafeInteger(length)) {
    throw new OcfHeaderError("Avro byte value has an invalid length");
  }
  if (length > bytes.length - cursor.offset) {
    throw new OcfHeaderError("Avro byte value is truncated");
  }
  const end = cursor.offset + length;
  const value = bytes.slice(cursor.offset, end);
  cursor.offset = end;
  return value;
}
function readDataBytes(bytes, cursor) {
  try {
    return readBytes(bytes, cursor);
  } catch (error) {
    if (error instanceof OcfHeaderError) {
      return fail(error.message);
    }
    throw error;
  }
}
function readString(bytes, cursor) {
  return new TextDecoder().decode(readBytes(bytes, cursor));
}
function readMetadata(bytes, cursor) {
  const metadata = {};
  let blockCount = readLong(bytes, cursor);
  let entryCount = 0;
  while (blockCount !== 0) {
    if (!Number.isSafeInteger(blockCount)) {
      throw new OcfHeaderError("OCF metadata block count is invalid");
    }
    let blockEnd;
    if (blockCount < 0) {
      blockCount = -blockCount;
      const blockSize = readLong(bytes, cursor);
      if (blockSize < 0 || blockSize > bytes.length - cursor.offset) {
        throw new OcfHeaderError("OCF metadata block size is invalid");
      }
      blockEnd = cursor.offset + blockSize;
    }
    if (blockCount > MAX_METADATA_ENTRIES || blockCount > Math.floor((bytes.length - cursor.offset) / 2)) {
      throw new OcfHeaderError("OCF metadata block count is unreasonable");
    }
    for (let index = 0; index < blockCount; index += 1) {
      const key = readString(bytes, cursor);
      const value = readBytes(bytes, cursor);
      metadata[key] = new TextDecoder().decode(value);
      entryCount += 1;
    }
    if (blockEnd !== void 0 && cursor.offset !== blockEnd) {
      throw new OcfHeaderError("OCF metadata block size does not match entries");
    }
    blockCount = readLong(bytes, cursor);
  }
  if (entryCount > MAX_METADATA_ENTRIES) {
    throw new OcfHeaderError("OCF metadata contains too many entries");
  }
  return metadata;
}
function parseSchema(value) {
  if (!value) {
    throw new OcfHeaderError("OCF header does not contain avro.schema");
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new OcfHeaderError("OCF header schema is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || parsed.type !== "record" || !Array.isArray(parsed.fields)) {
    throw new OcfHeaderError("OCF header schema is not a record schema");
  }
  for (const field of parsed.fields ?? []) {
    if (field === null || typeof field !== "object" || typeof field.name !== "string" || !("type" in field)) {
      throw new OcfHeaderError("OCF header contains an invalid field schema");
    }
  }
  return parsed;
}
function parseOcfHeader(bytes) {
  if (bytes.length < OCF_MAGIC.length || !OCF_MAGIC.every((value, index) => bytes[index] === value)) {
    throw new OcfHeaderError("OCF magic bytes are invalid");
  }
  const cursor = { offset: OCF_MAGIC.length };
  const metadata = readMetadata(bytes, cursor);
  const syncEnd = cursor.offset + OCF_SYNC_MARKER_LENGTH;
  if (syncEnd > bytes.length) {
    throw new OcfHeaderError("OCF sync marker is truncated");
  }
  return {
    metadata,
    schema: parseSchema(metadata["avro.schema"]),
    codec: metadata["avro.codec"] ?? null,
    syncMarker: bytes.slice(cursor.offset, syncEnd),
    bodyOffset: syncEnd
  };
}
function fullName(name, namespace) {
  return name.includes(".") || !namespace ? name : `${namespace}.${name}`;
}
function collectNamedSchemas(node, named, namespace) {
  if (Array.isArray(node) || typeof node === "string") {
    if (Array.isArray(node)) {
      for (const item of node)
        collectNamedSchemas(item, named, namespace);
    }
    return;
  }
  if (typeof node.type !== "string") {
    collectNamedSchemas(node.type, named, namespace);
    return;
  }
  if (node.type === "record" || node.type === "enum" || node.type === "fixed") {
    if (typeof node.name !== "string")
      return;
    const name = fullName(node.name, node.namespace);
    named.set(name, node);
    named.set(node.name, node);
    if (node.type === "record") {
      const childNamespace = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
      for (const field of node.fields ?? []) {
        collectNamedSchemas(field.type, named, childNamespace);
      }
    }
    return;
  }
  if (node.type === "array" && node.items) {
    collectNamedSchemas(node.items, named, namespace);
  } else if (node.type === "map" && node.values) {
    collectNamedSchemas(node.values, named, namespace);
  }
}
function resolveSchema(node, named) {
  if (typeof node !== "string")
    return node;
  return named.get(node) ?? node;
}
function readFloat(bytes, cursor, size) {
  if (size > bytes.length - cursor.offset) {
    return fail("Avro floating-point value is truncated");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + cursor.offset, size);
  const value = size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
  cursor.offset += size;
  return value;
}
function readArray(bytes, cursor, itemSchema, named) {
  const values = [];
  let blockCount = readDataLong(bytes, cursor);
  while (blockCount !== 0) {
    let blockEnd;
    if (blockCount < 0) {
      blockCount = -blockCount;
      const blockSize = readDataLong(bytes, cursor);
      if (blockSize < 0 || blockSize > bytes.length - cursor.offset) {
        return fail("Avro array block size is invalid");
      }
      blockEnd = cursor.offset + blockSize;
    }
    if (!Number.isSafeInteger(blockCount) || blockCount > bytes.length) {
      return fail("Avro array block count is invalid");
    }
    for (let index = 0; index < blockCount; index += 1) {
      values.push(readValue(bytes, cursor, itemSchema, named));
    }
    if (blockEnd !== void 0 && cursor.offset !== blockEnd) {
      return fail("Avro array block size does not match values");
    }
    blockCount = readDataLong(bytes, cursor);
  }
  return values;
}
function readMap(bytes, cursor, valueSchema, named) {
  const values = {};
  let blockCount = readDataLong(bytes, cursor);
  while (blockCount !== 0) {
    let blockEnd;
    if (blockCount < 0) {
      blockCount = -blockCount;
      const blockSize = readDataLong(bytes, cursor);
      if (blockSize < 0 || blockSize > bytes.length - cursor.offset) {
        return fail("Avro map block size is invalid");
      }
      blockEnd = cursor.offset + blockSize;
    }
    if (!Number.isSafeInteger(blockCount) || blockCount > bytes.length) {
      return fail("Avro map block count is invalid");
    }
    for (let index = 0; index < blockCount; index += 1) {
      const key = readString(bytes, cursor);
      values[key] = readValue(bytes, cursor, valueSchema, named);
    }
    if (blockEnd !== void 0 && cursor.offset !== blockEnd) {
      return fail("Avro map block size does not match values");
    }
    blockCount = readDataLong(bytes, cursor);
  }
  return values;
}
function readValue(bytes, cursor, originalSchema, named) {
  const schema = resolveSchema(originalSchema, named);
  if (Array.isArray(schema)) {
    const branch = readDataLong(bytes, cursor);
    if (!Number.isSafeInteger(branch) || branch < 0 || branch >= schema.length) {
      return fail("Avro union branch is invalid");
    }
    const branchSchema = schema[branch];
    if (branchSchema === void 0)
      return fail("Avro union branch is invalid");
    return readValue(bytes, cursor, branchSchema, named);
  }
  if (typeof schema === "string") {
    switch (schema) {
      case "null":
        return null;
      case "boolean": {
        const byte = bytes[cursor.offset];
        if (byte === void 0)
          return fail("Avro boolean is truncated");
        cursor.offset += 1;
        if (byte !== 0 && byte !== 1)
          return fail("Avro boolean is invalid");
        return byte === 1;
      }
      case "int":
      case "long":
        return readDataLong(bytes, cursor);
      case "float":
        return readFloat(bytes, cursor, 4);
      case "double":
        return readFloat(bytes, cursor, 8);
      case "bytes":
        return readDataBytes(bytes, cursor);
      case "string":
        return new TextDecoder().decode(readDataBytes(bytes, cursor));
      default:
        return fail(`Unknown Avro named type: ${schema}`);
    }
  }
  if (typeof schema.type !== "string") {
    return readValue(bytes, cursor, schema.type, named);
  }
  if (schema.logicalType) {
    return readValue(bytes, cursor, schema.type, named);
  }
  switch (schema.type) {
    case "null":
    case "boolean":
    case "int":
    case "long":
    case "float":
    case "double":
    case "bytes":
    case "string":
      return readValue(bytes, cursor, schema.type, named);
    case "record": {
      const record = {};
      for (const field of schema.fields ?? []) {
        record[field.name] = readValue(bytes, cursor, field.type, named);
      }
      return record;
    }
    case "enum": {
      const index = readDataLong(bytes, cursor);
      const symbols = schema.symbols ?? [];
      if (index < 0 || index >= symbols.length)
        return fail("Avro enum index is invalid");
      const symbol = symbols[index];
      if (symbol === void 0)
        return fail("Avro enum symbol is missing");
      return symbol;
    }
    case "fixed": {
      const size = schema.size;
      if (!Number.isSafeInteger(size) || size === void 0 || size < 0) {
        return fail("Avro fixed type has an invalid size");
      }
      if (size > bytes.length - cursor.offset)
        return fail("Avro fixed value is truncated");
      const value = bytes.slice(cursor.offset, cursor.offset + size);
      cursor.offset += size;
      return value;
    }
    case "array":
      if (!schema.items)
        return fail("Avro array type has no items schema");
      return readArray(bytes, cursor, schema.items, named);
    case "map":
      if (!schema.values)
        return fail("Avro map type has no values schema");
      return readMap(bytes, cursor, schema.values, named);
    default:
      return fail("Avro schema contains an unsupported type");
  }
}
function assertSyncMarker(bytes, offset, syncMarker) {
  if (syncMarker.length !== OCF_SYNC_MARKER_LENGTH) {
    return fail("OCF sync marker has an invalid length");
  }
  if (syncMarker.length > bytes.length - offset) {
    return fail("Avro block sync marker is truncated");
  }
  for (let index = 0; index < syncMarker.length; index += 1) {
    if (bytes[offset + index] !== syncMarker[index]) {
      return fail("Avro block sync marker does not match the OCF header");
    }
  }
}
function readBlock(bytes, cursor, schema, syncMarker, named, maxRecords, recordFilter, decodedRecords) {
  const recordCount = readDataLong(bytes, cursor);
  if (!Number.isSafeInteger(recordCount) || recordCount <= 0) {
    return fail("Avro block record count is invalid");
  }
  const payloadSize = readDataLong(bytes, cursor);
  if (!Number.isSafeInteger(payloadSize) || payloadSize < 0) {
    return fail("Avro block payload size is invalid");
  }
  if (payloadSize > bytes.length - cursor.offset - syncMarker.length) {
    return fail("Avro block payload is truncated");
  }
  const payloadEnd = cursor.offset + payloadSize;
  const payload = bytes.subarray(cursor.offset, payloadEnd);
  const payloadCursor = { offset: 0 };
  const records = [];
  for (let index = 0; index < recordCount; index += 1) {
    if (!recordFilter && maxRecords !== void 0 && decodedRecords.count >= maxRecords) {
      throw new AvroOcfError("OUT_OF_MEMORY_GUARD", "Avro decoded record count exceeds the configured limit");
    }
    const value = readValue(payload, payloadCursor, schema, named);
    if (value === null || typeof value !== "object" || value instanceof Uint8Array || Array.isArray(value)) {
      return fail("Avro top-level schema did not produce a record");
    }
    const record = value;
    if (!recordFilter || recordFilter(record)) {
      if (maxRecords !== void 0 && decodedRecords.count >= maxRecords) {
        throw new AvroOcfError("OUT_OF_MEMORY_GUARD", "Avro decoded record count exceeds the configured limit");
      }
      records.push(record);
      decodedRecords.count += 1;
    }
  }
  if (payloadCursor.offset !== payload.length) {
    return fail("Avro block payload has trailing bytes");
  }
  assertSyncMarker(bytes, payloadEnd, syncMarker);
  cursor.offset = payloadEnd + syncMarker.length;
  return records;
}
function parseHeaderForDecoder(header) {
  try {
    return parseOcfHeader(header);
  } catch (error) {
    if (error instanceof OcfHeaderError) {
      return fail(error.message);
    }
    throw error;
  }
}
function prepareAvroDecoderContext(header) {
  const parsedHeader = header instanceof Uint8Array ? parseHeaderForDecoder(header) : header;
  const schema = parsedHeader.schema;
  const named = /* @__PURE__ */ new Map();
  collectNamedSchemas(schema, named);
  return {
    header: parsedHeader,
    schema,
    named
  };
}
function resolveDecoderContext(headerOrContext) {
  if ("named" in headerOrContext && headerOrContext.named instanceof Map) {
    return headerOrContext;
  }
  return prepareAvroDecoderContext(headerOrContext);
}
function decodeNullBody(headerOrContext, body, options = {}) {
  const { header, schema, named } = resolveDecoderContext(headerOrContext);
  const cursor = { offset: 0 };
  const records = [];
  const decodedRecords = { count: 0 };
  while (cursor.offset < body.length) {
    records.push(...readBlock(body, cursor, schema, header.syncMarker, named, options.maxRecords, options.recordFilter, decodedRecords));
  }
  return records;
}
function decodeAvroOcfToJson(avroBytes, options = {}) {
  const header = parseHeaderForDecoder(avroBytes);
  const codec = header.codec ?? "null";
  if (codec !== "null") {
    throw new AvroOcfError("UNSUPPORTED_CODEC", `Unsupported Avro codec: ${codec}`);
  }
  return decodeNullBody(header, avroBytes.slice(header.bodyOffset), options);
}

// ../fusou-compaction-core/dist/snapshots.js
function normalizeEpochMs(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1e3 : raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed < 1e12 ? parsed * 1e3 : parsed : null;
  }
  return null;
}
function normalizeBattleResult(raw) {
  if (!raw || typeof raw !== "object")
    return null;
  const obj = raw;
  const winRank = typeof obj["win_rank"] === "string" ? obj["win_rank"] : null;
  if (!winRank)
    return null;
  let mvpIndexes = void 0;
  if (Array.isArray(obj["mvp_ship_indexes"])) {
    mvpIndexes = obj["mvp_ship_indexes"].map(Number).filter((n) => Number.isSafeInteger(n) && n >= 0);
  } else {
    const rawMvp = Number(obj["api_mvp"] ?? obj["mvp"]);
    if (Number.isSafeInteger(rawMvp) && rawMvp > 0) {
      mvpIndexes = [rawMvp - 1];
    }
  }
  const dropShipId = typeof obj["drop_ship_id"] === "number" && Number.isSafeInteger(obj["drop_ship_id"]) && obj["drop_ship_id"] > 0 ? obj["drop_ship_id"] : null;
  return {
    ...obj,
    win_rank: winRank,
    drop_ship_id: dropShipId,
    ...mvpIndexes !== void 0 ? { mvp_ship_indexes: mvpIndexes } : {}
  };
}
function buildOverviewSnapshot(sorties, options) {
  const maxBattles = options?.maxBattles ?? 500;
  const periodTag = options?.periodTag ?? sorties[0]?.period_tag ?? "latest";
  const sortedSorties = [...sorties].sort((a, b) => b.timestamp - a.timestamp);
  const snapshotBattles = [];
  const snapshotCells = [];
  const snapshotEnemyDecks = [];
  const snapshotEnemyShips = [];
  const seenDeckUuids = /* @__PURE__ */ new Set();
  const seenShipUuids = /* @__PURE__ */ new Set();
  const includedEnvUuids = /* @__PURE__ */ new Set();
  for (const sortie of sortedSorties) {
    if (snapshotBattles.length >= maxBattles)
      break;
    const resultByUuid = /* @__PURE__ */ new Map();
    const resultByIndex = /* @__PURE__ */ new Map();
    for (const br of sortie.battleResults) {
      const u = typeof br["uuid"] === "string" ? br["uuid"] : "";
      if (u)
        resultByUuid.set(u, br);
      const idx = typeof br["index"] === "number" && Number.isFinite(br["index"]) ? br["index"] : null;
      if (idx !== null)
        resultByIndex.set(idx, br);
    }
    const deckById = /* @__PURE__ */ new Map();
    if (Array.isArray(sortie.enemyDecks)) {
      for (const d of sortie.enemyDecks) {
        const u = typeof d["uuid"] === "string" ? d["uuid"] : "";
        if (u)
          deckById.set(u, d);
      }
    }
    const cellByBattleUuid = /* @__PURE__ */ new Map();
    for (const cell of sortie.cells) {
      const bRef = cell["battles"];
      if (typeof bRef === "string" && bRef) {
        cellByBattleUuid.set(bRef, cell);
      } else if (Array.isArray(bRef)) {
        for (const u of bRef) {
          if (typeof u === "string" && u) {
            cellByBattleUuid.set(u, cell);
          }
        }
      }
    }
    const firstCell = sortie.cells[0];
    let sortieBattleIdx = 0;
    for (const battle of sortie.battles) {
      if (snapshotBattles.length >= maxBattles)
        break;
      const rawIndex = battle["index"];
      const battleIndex = typeof rawIndex === "number" && Number.isFinite(rawIndex) ? rawIndex : sortieBattleIdx;
      sortieBattleIdx++;
      const battleUuid = typeof battle["uuid"] === "string" ? battle["uuid"] : "";
      const brRef = battle["battle_result"];
      const rawResult = typeof brRef === "object" && brRef !== null ? brRef : (typeof brRef === "string" ? resultByUuid.get(brRef) : null) || resultByUuid.get(battleUuid) || resultByIndex.get(battleIndex) || null;
      const normalizedResult = normalizeBattleResult(rawResult);
      let cell = cellByBattleUuid.get(battleUuid);
      if (!cell) {
        for (const c of sortie.cells) {
          if (Array.isArray(c["battle_index"]) && c["battle_index"].map(Number).includes(battleIndex)) {
            cell = c;
            break;
          }
        }
      }
      let derivedCellId = null;
      if (cell && Array.isArray(cell["battle_index"]) && Array.isArray(cell["cell_index"])) {
        const pos = cell["battle_index"].map(Number).indexOf(battleIndex);
        if (pos >= 0 && pos < cell["cell_index"].length) {
          const cid = Number(cell["cell_index"][pos]);
          if (Number.isFinite(cid))
            derivedCellId = cid;
        }
      }
      const rawCellId = battle["cell_id"] ?? derivedCellId ?? cell?.["cell_id"] ?? cell?.["event_id"] ?? NaN;
      const cellId = Number(rawCellId);
      if (!Number.isFinite(cellId))
        continue;
      const mapareaId = Number(battle["maparea_id"] ?? cell?.["maparea_id"] ?? firstCell?.["maparea_id"] ?? NaN);
      const mapinfoNo = Number(battle["mapinfo_no"] ?? cell?.["mapinfo_no"] ?? firstCell?.["mapinfo_no"] ?? NaN);
      const normalizedTs = normalizeEpochMs(battle["timestamp"]) ?? normalizeEpochMs(battle["midnight_timestamp"]) ?? normalizeEpochMs(sortie.timestamp) ?? Date.now();
      const enemyDeckId = battle["e_deck_id"] != null ? String(battle["e_deck_id"]).trim() : "";
      const matchedDeck = enemyDeckId ? deckById.get(enemyDeckId) : null;
      const enemySummary = typeof battle["enemy_summary"] === "string" && battle["enemy_summary"] ? battle["enemy_summary"] : typeof matchedDeck?.["name"] === "string" ? matchedDeck["name"] : void 0;
      snapshotBattles.push({
        ...battle,
        index: battleIndex,
        cell_id: cellId,
        timestamp: normalizedTs,
        env_uuid: sortie.env_uuid,
        maparea_id: Number.isFinite(mapareaId) ? mapareaId : null,
        mapinfo_no: Number.isFinite(mapinfoNo) ? mapinfoNo : null,
        battle_result: normalizedResult,
        ...enemySummary ? { enemy_summary: enemySummary } : {}
      });
      includedEnvUuids.add(sortie.env_uuid);
    }
    if (includedEnvUuids.has(sortie.env_uuid)) {
      if (Array.isArray(sortie.enemyDecks)) {
        for (const deck of sortie.enemyDecks) {
          const u = String(deck["uuid"] || "");
          if (!u || !seenDeckUuids.has(u)) {
            if (u)
              seenDeckUuids.add(u);
            snapshotEnemyDecks.push(deck);
          }
        }
      }
      if (Array.isArray(sortie.enemyShips)) {
        for (const ship of sortie.enemyShips) {
          const u = String(ship["uuid"] || "");
          if (!u || !seenShipUuids.has(u)) {
            if (u)
              seenShipUuids.add(u);
            snapshotEnemyShips.push(ship);
          }
        }
      }
      for (const cell of sortie.cells) {
        snapshotCells.push({
          ...cell,
          env_uuid: sortie.env_uuid
        });
      }
    }
  }
  if (Array.isArray(options?.existingEnemyDecks)) {
    for (const deck of options.existingEnemyDecks) {
      const u = String(deck["uuid"] || "");
      if (!u || !seenDeckUuids.has(u)) {
        if (u)
          seenDeckUuids.add(u);
        snapshotEnemyDecks.push(deck);
      }
    }
  }
  if (Array.isArray(options?.existingEnemyShips)) {
    for (const ship of options.existingEnemyShips) {
      const u = String(ship["uuid"] || "");
      if (!u || !seenShipUuids.has(u)) {
        if (u)
          seenShipUuids.add(u);
        snapshotEnemyShips.push(ship);
      }
    }
  }
  return {
    success: true,
    period_tag: periodTag,
    table_version: sorties[0]?.table_version ?? null,
    snapshot_timestamp: Date.now(),
    battles: snapshotBattles,
    cells: snapshotCells,
    enemy_decks: snapshotEnemyDecks,
    enemy_ships: snapshotEnemyShips
  };
}
function buildDropsSnapshot(sorties, options) {
  const maxBattles = options?.maxBattles ?? 1e3;
  const periodTag = options?.periodTag ?? sorties[0]?.period_tag ?? "latest";
  const overview = buildOverviewSnapshot(sorties, { maxBattles, periodTag });
  return {
    success: true,
    period_tag: periodTag,
    table_version: overview.table_version ?? null,
    snapshot_timestamp: overview.snapshot_timestamp,
    battles: overview.battles,
    mst_ships: []
  };
}

// ../../node_modules/.pnpm/nanostores@1.1.0/node_modules/nanostores/clean-stores/index.js
var clean = /* @__PURE__ */ Symbol("clean");

// ../../node_modules/.pnpm/nanostores@1.1.0/node_modules/nanostores/atom/index.js
var listenerQueue = [];
var lqIndex = 0;
var QUEUE_ITEMS_PER_LISTENER = 4;
var epoch = 0;
var atom = /* @__NO_SIDE_EFFECTS__ */ (initialValue) => {
  let listeners = [];
  let $atom = {
    get() {
      if (!$atom.lc) {
        $atom.listen(() => {
        })();
      }
      return $atom.value;
    },
    lc: 0,
    listen(listener) {
      $atom.lc = listeners.push(listener);
      return () => {
        for (let i = lqIndex + QUEUE_ITEMS_PER_LISTENER; i < listenerQueue.length; ) {
          if (listenerQueue[i] === listener) {
            listenerQueue.splice(i, QUEUE_ITEMS_PER_LISTENER);
          } else {
            i += QUEUE_ITEMS_PER_LISTENER;
          }
        }
        let index = listeners.indexOf(listener);
        if (~index) {
          listeners.splice(index, 1);
          if (!--$atom.lc) $atom.off();
        }
      };
    },
    notify(oldValue, changedKey) {
      epoch++;
      let runListenerQueue = !listenerQueue.length;
      for (let listener of listeners) {
        listenerQueue.push(listener, $atom.value, oldValue, changedKey);
      }
      if (runListenerQueue) {
        for (lqIndex = 0; lqIndex < listenerQueue.length; lqIndex += QUEUE_ITEMS_PER_LISTENER) {
          listenerQueue[lqIndex](
            listenerQueue[lqIndex + 1],
            listenerQueue[lqIndex + 2],
            listenerQueue[lqIndex + 3]
          );
        }
        listenerQueue.length = 0;
      }
    },
    /* It will be called on last listener unsubscribing.
       We will redefine it in onMount and onStop. */
    off() {
    },
    set(newValue) {
      let oldValue = $atom.value;
      if (oldValue !== newValue) {
        $atom.value = newValue;
        $atom.notify(oldValue);
      }
    },
    subscribe(listener) {
      let unbind = $atom.listen(listener);
      listener($atom.value);
      return unbind;
    },
    value: initialValue
  };
  if (process.env.NODE_ENV !== "production") {
    $atom[clean] = () => {
      listeners = [];
      $atom.lc = 0;
      $atom.off();
    };
  }
  return $atom;
};

// src/features/simulator/types.ts
function emptyFleetSlot() {
  return {
    shipId: null,
    shipLevel: null,
    equipIds: [null, null, null, null, null],
    equipImprovement: [0, 0, 0, 0, 0],
    equipProficiency: [0, 0, 0, 0, 0],
    exSlotId: null,
    exSlotImprovement: 0
  };
}
function emptyAirBase() {
  return {
    equipIds: [null, null, null, null],
    equipImprovement: [0, 0, 0, 0],
    equipProficiency: [0, 0, 0, 0]
  };
}

// src/features/simulator/state.ts
var simulatorFleetRevision = atom(0);
var simulatorAirbaseRevision = atom(0);
var simulatorDisplayRevision = atom(0);
var simulatorReadOnly = atom(false);
var simulatorCombinedFleetType = atom(0);
var simulatorFleetState = atom({
  fleet1: [],
  fleet2: [],
  fleet3: [],
  fleet4: []
});
var simulatorAirbaseState = atom([]);
var simulatorSearchQuery = atom("");
function cloneFleetSlot(slot) {
  return {
    ...slot,
    equipIds: [...slot.equipIds],
    equipImprovement: [...slot.equipImprovement],
    equipProficiency: [...slot.equipProficiency],
    ...slot.statOverrides === void 0 ? {} : { statOverrides: { ...slot.statOverrides } },
    ...slot.instanceStats === void 0 ? {} : { instanceStats: { ...slot.instanceStats } }
  };
}
function cloneAirBaseSlot(base) {
  return {
    ...base,
    equipIds: [...base.equipIds],
    equipImprovement: [...base.equipImprovement],
    equipProficiency: [...base.equipProficiency]
  };
}
function snapshotFleetState() {
  return {
    fleet1: state.fleet1.map(cloneFleetSlot),
    fleet2: state.fleet2.map(cloneFleetSlot),
    fleet3: state.fleet3.map(cloneFleetSlot),
    fleet4: state.fleet4.map(cloneFleetSlot)
  };
}
function snapshotAirbaseState() {
  return state.airBases.map(cloneAirBaseSlot);
}
var state = {
  // Master data
  mstShips: {},
  mstSlotItems: {},
  mstSlotItemEquipTypes: {},
  hasMasterData: false,
  // Equipment bonus / synergy data
  slotItemEffects: null,
  slotItemEffectsMeta: null,
  // Observed speed data (turbine/boiler upgrades) from soku_speed_observed
  sokuSpeedData: null,
  // Weapon icon sprite sheet
  weaponIconFrames: {},
  spriteSheetW: 0,
  spriteSheetH: 0,
  spriteSheetUrl: "",
  // Ship type icon sprite sheet (organize_ship)
  shipTypeIconFrames: {},
  shipTypeSpriteSheetW: 0,
  shipTypeSpriteSheetH: 0,
  shipTypeSpriteSheetUrl: "",
  // Asset URL maps
  bannerMap: {},
  cardMap: {},
  shipIconMap: {},
  assetBaseUrl: "",
  equipCardMap: {},
  equipItemOnMap: {},
  equipItemUpMap: {},
  // Combined fleet type: 0=通常, 1=機動部隊, 2=水上打撃部隊, 3=輸送護衛部隊
  combinedFleetType: 0,
  // Per-fleet selected formation ID (0 = none)
  fleetFormations: { 1: 0, 2: 0, 3: 0, 4: 0 },
  // Fleet state
  fleet1: Array.from({ length: 6 }, emptyFleetSlot),
  fleet2: Array.from({ length: 6 }, emptyFleetSlot),
  fleet3: Array.from({ length: 7 }, emptyFleetSlot),
  fleet4: Array.from({ length: 6 }, emptyFleetSlot),
  fleetSectionVisible: {
    1: true,
    2: true,
    3: false,
    4: false
  },
  airbaseSectionVisible: true,
  visibleAirbaseCount: 3,
  fleetSlotLayoutMode: "3x2",
  airBases: Array.from({ length: 3 }, emptyAirBase),
  // Modal callbacks and state
  shipModalCb: null,
  equipModalCb: null,
  shipModalCurrentId: null,
  equipModalCurrentId: null,
  shipModalSource: "master",
  equipModalSource: "master",
  shipModalSideFilter: "ally",
  equipModalSideFilter: "ally",
  // Ship modal target context
  shipModalTargetFleetIndex: null,
  shipModalTargetShipSlotIndex: null,
  // Equipment modal target context
  equipModalTargetKind: null,
  equipModalTargetFleetIndex: null,
  equipModalTargetShipSlotIndex: null,
  equipModalTargetAirBaseIndex: null,
  equipModalTargetSlotIdx: -1,
  // Snapshot data
  snapshotShips: {},
  snapshotSlotItems: {},
  // UI guard: true when active workspace entry is locked and edits must be blocked.
  isWorkspaceReadOnly: false,
  // Equipment filtering master data
  /** stype id → equip_type map (default allowed equip types per ship type) */
  mstStypes: {},
  /** Set of equipment type[2] IDs allowed in exslot */
  equipExslotSet: /* @__PURE__ */ new Set(),
  /** ship_id → per-ship equipment type overrides */
  mstEquipShip: {},
  /** equip_id → exslot ship restrictions */
  mstEquipExslotShip: {},
  /** ship_id → excluded exslot equipment type[2] IDs */
  mstEquipLimitExslot: {}
};
simulatorReadOnly.set(state.isWorkspaceReadOnly);
simulatorCombinedFleetType.set(state.combinedFleetType);
simulatorFleetState.set(snapshotFleetState());
simulatorAirbaseState.set(snapshotAirbaseState());

// src/features/simulator/simulator-selectors.ts
function getAssetBaseUrl() {
  return state.assetBaseUrl;
}
function getBannerMap() {
  return state.bannerMap;
}

// src/features/simulator/equip-calc.ts
function buildImageUrl(base, key, opts) {
  const cleanBase = base.replace(/\/$/, "");
  const sourceUrl = `${cleanBase}/${key}`;
  if (!opts) return sourceUrl;
  try {
    const u = new URL(cleanBase);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.startsWith("192.168.") || u.hostname.startsWith("10.") || u.hostname.endsWith(".local")) {
      return sourceUrl;
    }
  } catch {
    return sourceUrl;
  }
  const params = [];
  if (opts.f) params.push(`format=${opts.f}`);
  if (params.length === 0) return sourceUrl;
  return `${cleanBase}/cdn-cgi/image/${params.join(",")}/${key}`;
}
function bannerUrl(shipId, options) {
  const assetBaseUrl = getAssetBaseUrl();
  const key = getBannerMap()[String(shipId)];
  if (assetBaseUrl && key) return buildImageUrl(assetBaseUrl, key, options);
  if (!assetBaseUrl) {
    const fallback = `/api/asset-sync/ship-banner/${shipId}`;
    return fallback;
  }
  return "";
}

// src/features/battles/payload-guards.ts
function parseFiniteNumber(value) {
  if (value == null || typeof value === "string" && value.trim() === "") {
    return { value: null, status: "missing" };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { value, status: "valid" } : { value: null, status: "invalid" };
  }
  if (typeof value !== "string") {
    return { value: null, status: "invalid" };
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? { value: parsed, status: "valid" } : { value: null, status: "invalid" };
}

// src/features/battles/helpers.ts
function battleRowIndexForSort(value) {
  if (value == null || typeof value === "string" && value.trim() === "") {
    return Number.MAX_SAFE_INTEGER;
  }
  const index = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(index) && index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}
function normalizeNullableNumber(value) {
  return parseFiniteNumber(value).value;
}
function normalizeHpValue(value) {
  const parsed = parseFiniteNumber(value).value;
  if (parsed === null || parsed < 0) return null;
  return parsed;
}
function countValidHps(snapshot) {
  if (!Array.isArray(snapshot)) return 0;
  return snapshot.reduce((count, v) => normalizeHpValue(v) !== null ? count + 1 : count, 0);
}

// src/features/battles/resolvers/indexes.ts
function normalizeTimestamp(value) {
  const normalizeEpochMs2 = (raw) => raw < 1e12 ? raw * 1e3 : raw;
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeEpochMs2(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? normalizeEpochMs2(parsed) : null;
  }
  return null;
}

// src/features/battles/resolvers/detail.ts
function rowsByUuid(rows, uuid) {
  if (!uuid) return [];
  return rows.filter((row) => String(row["uuid"] ?? "") === uuid).sort(
    (left, right) => battleRowIndexForSort(left["index"]) - battleRowIndexForSort(right["index"])
  );
}
function firstByUuid(rows, uuid) {
  return rowsByUuid(rows, typeof uuid === "string" ? uuid : "")[0] ?? null;
}
function scopeRows(rows, envUuid) {
  return rows.filter((row) => String(row["env_uuid"] ?? "") === envUuid);
}
function normalizePositiveMapCoordinate(value) {
  const normalized = normalizeNullableNumber(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}
function firstByIndex(rows, index) {
  return rows.find((row) => Number(row["index"] ?? Number.NaN) === index) ?? null;
}
function resolveLinked(rows, explicitUuid, battleIndex) {
  return firstByUuid(rows, explicitUuid) ?? firstByIndex(rows, battleIndex);
}
function positiveNumbers(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => Number(entry ?? Number.NaN)).filter((entry) => Number.isSafeInteger(entry) && entry >= 0);
}
function groupIds(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string" && entry.length > 0);
  }
  return typeof value === "string" && value.length > 0 ? [value] : [];
}
function relatedCell(cells, battle, battleIndex) {
  const battleCellId = Number(battle["cell_id"] ?? Number.NaN);
  const matching = cells.filter(
    (cell) => positiveNumbers(cell["battle_index"]).includes(battleIndex)
  );
  const exact = matching.find((cell) => {
    const indexes = positiveNumbers(cell["battle_index"]);
    const cellIndexes = positiveNumbers(cell["cell_index"]);
    const position = indexes.indexOf(battleIndex);
    return position >= 0 && Number(cellIndexes[position]) === battleCellId;
  });
  return exact ?? matching[0] ?? cells.find(
    (cell) => positiveNumbers(cell["cell_index"]).includes(battleCellId)
  ) ?? null;
}
function findBattleDetailContext(options) {
  const scopedBattles = scopeRows(options.tables.battle, options.envUuid);
  const candidates = scopedBattles.filter(
    (row) => Number(row["index"] ?? Number.NaN) === options.battleIndex
  );
  if (candidates.length === 0) return null;
  const battle = [...candidates].sort(
    (left, right) => (normalizeTimestamp(left["timestamp"]) ?? Number.MAX_SAFE_INTEGER) - (normalizeTimestamp(right["timestamp"]) ?? Number.MAX_SAFE_INTEGER)
  )[0];
  if (!battle) return null;
  const cell = relatedCell(
    scopeRows(options.tables.cells, options.envUuid),
    battle,
    options.battleIndex
  );
  return {
    battle,
    cell,
    scopedBattles,
    duplicateBattleIndexes: Math.max(0, candidates.length - 1)
  };
}
function battleIndexes(battles, cell) {
  const availableIndexes = new Set(
    battles.map((row) => Number(row["index"] ?? Number.NaN)).filter((index) => Number.isSafeInteger(index) && index >= 0)
  );
  const cellBattleIndexes = positiveNumbers(cell?.["battle_index"]);
  const cellIndexes = positiveNumbers(cell?.["cell_index"]);
  if (cellIndexes.length > 0) {
    const battleByCellId = new Map(
      battles.map((row) => [Number(row["cell_id"] ?? Number.NaN), row])
    );
    const orderedByCell = cellIndexes.map(
      (cellId) => Number(battleByCellId.get(cellId)?.["index"] ?? Number.NaN)
    ).filter((index) => availableIndexes.has(index));
    if (orderedByCell.length > 0) {
      return [...new Set(orderedByCell)];
    }
  }
  if (cellBattleIndexes.length > 0) {
    const matchingIndexes = cellBattleIndexes.filter(
      (index) => availableIndexes.has(index)
    );
    if (matchingIndexes.length === cellBattleIndexes.length) {
      return [...new Set(matchingIndexes)].sort((left, right) => left - right);
    }
  }
  return [...availableIndexes].sort((left, right) => left - right);
}
function airBaseAttackRows(value) {
  if (Array.isArray(value)) {
    return value.filter(
      (entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry)
    );
  }
  if (value && typeof value === "object" && Array.isArray(value["attacks"])) {
    return airBaseAttackRows(value["attacks"]);
  }
  return [];
}
function addPositiveIds(value, target) {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    const id = Number(entry ?? 0);
    if (Number.isSafeInteger(id) && id > 0) target.add(id);
  }
}
function hpScore(rows, snapshot) {
  if (rows.length === 0 || snapshot.length === 0) return Number.MAX_SAFE_INTEGER;
  const sorted = [...rows].sort(
    (left, right) => battleRowIndexForSort(left["index"]) - battleRowIndexForSort(right["index"])
  );
  const validSnapshotCount = countValidHps(snapshot);
  const length = Math.min(sorted.length, snapshot.length);
  let score = Math.abs(sorted.length - validSnapshotCount) * 20;
  for (let index = 0; index < length; index += 1) {
    const row = sorted[index];
    const snapshotValue = snapshot[index];
    if (!row || snapshotValue === void 0) continue;
    const rowHp = normalizeHpValue(row["nowhp"] ?? row["maxhp"]);
    const snapshotHp = normalizeHpValue(snapshotValue);
    if (rowHp === null && snapshotHp === null) continue;
    if (rowHp === null || snapshotHp === null) {
      score += 50;
      continue;
    }
    score += Math.abs(rowHp - snapshotHp);
  }
  return score;
}
function fleetRows(battle, decks, ships, slotItems, side) {
  const hpSnapshot = side === "own" ? battle["f_nowhps"] ?? battle["midnight_f_nowhps"] : battle["e_nowhps"] ?? battle["midnight_e_nowhps"];
  const candidateGroups = /* @__PURE__ */ new Map();
  for (const ship of ships) {
    const group = String(ship["uuid"] ?? "");
    if (!group) continue;
    const rows = candidateGroups.get(group) ?? [];
    rows.push(ship);
    candidateGroups.set(group, rows);
  }
  for (const rows of candidateGroups.values()) {
    rows.sort(
      (left, right) => battleRowIndexForSort(left["index"]) - battleRowIndexForSort(right["index"])
    );
  }
  let selectedGroups = [];
  if (side === "own") {
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (const deck of decks) {
      for (const group of groupIds(deck["ship_ids"])) {
        const score = hpScore(candidateGroups.get(group) ?? [], Array.isArray(hpSnapshot) ? hpSnapshot : []);
        if (score < bestScore) {
          bestScore = score;
          selectedGroups = [group];
        }
      }
    }
  } else {
    const deckId = String(battle["e_deck_id"] ?? "");
    selectedGroups = groupIds(decks.find((row) => String(row["uuid"] ?? "") === deckId)?.["ship_ids"]);
  }
  const shipGroups = new Set(selectedGroups);
  const groupRows = ships.filter((row) => shipGroups.has(String(row["uuid"] ?? ""))).sort(
    (left, right) => battleRowIndexForSort(left["index"]) - battleRowIndexForSort(right["index"])
  );
  const slotsByGroup = /* @__PURE__ */ new Map();
  for (const row of slotItems) {
    const group = String(row["uuid"] ?? "");
    if (!group) continue;
    const current = slotsByGroup.get(group) ?? [];
    current.push(row);
    slotsByGroup.set(group, current);
  }
  return groupRows.map((row) => ({
    ...row,
    slot_items: typeof row["slot"] === "string" ? slotsByGroup.get(row["slot"]) ?? [] : []
  }));
}
function indexedFleet(rows, masterShips, masterSlotItems, side) {
  const ships = new Map(masterShips.map((row) => [Number(row["id"] ?? 0), row]));
  const slotItems = new Map(masterSlotItems.map((row) => [Number(row["id"] ?? 0), row]));
  return rows.map((row) => {
    const shipId = Number(row["ship_id"] ?? row["mst_ship_id"] ?? 0) || null;
    const sourceSlots = (Array.isArray(row["slot_items"]) ? row["slot_items"] : []).filter((slot) => {
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) return false;
      return Number(slot["mst_slotitem_id"] ?? 0) > 0;
    });
    return {
      name: String(ships.get(shipId ?? 0)?.["name"] ?? (shipId ? `${side === "own" ? "\u8266" : "\u6575\u8266"}ID:${shipId}` : side === "own" ? "\u5473\u65B9\u8266" : "\u6575\u8266")),
      shipId,
      bannerUrl: shipId ? bannerUrl(shipId, { f: "auto" }) : "",
      level: normalizeNullableNumber(row["lv"]),
      nowhp: normalizeNullableNumber(row["nowhp"]),
      maxhp: normalizeNullableNumber(row["maxhp"]),
      karyoku: normalizeNullableNumber(row["karyoku"]),
      raisou: normalizeNullableNumber(row["raisou"]),
      taiku: normalizeNullableNumber(row["taiku"]),
      soukou: normalizeNullableNumber(row["soukou"]),
      equipments: sourceSlots.map((slot) => {
        const slotId = Number(slot["mst_slotitem_id"] ?? 0) || null;
        return {
          name: String(slotItems.get(slotId ?? 0)?.["name"] ?? (slotId ? `\u88C5\u5099ID:${slotId}` : "")),
          level: normalizeNullableNumber(slot["level"]),
          iconType: Array.isArray(slotItems.get(slotId ?? 0)?.["type"]) && (slotItems.get(slotId ?? 0)?.["type"]).length >= 4 ? Number((slotItems.get(slotId ?? 0)?.["type"])[3] ?? 0) || null : null,
          slotItemId: slotId
        };
      })
    };
  });
}
function resolveBattleDetail(options) {
  const context = findBattleDetailContext(options);
  if (!context) return null;
  const scopedTables = {
    battle: scopeRows(options.tables.battle, options.envUuid),
    cells: scopeRows(options.tables.cells, options.envUuid),
    battleResult: scopeRows(options.tables.battleResult, options.envUuid),
    ownDeck: scopeRows(options.tables.ownDeck, options.envUuid),
    ownShip: scopeRows(options.tables.ownShip, options.envUuid),
    ownSlotItem: scopeRows(options.tables.ownSlotItem, options.envUuid),
    enemyDeck: scopeRows(options.tables.enemyDeck, options.envUuid),
    enemyShip: scopeRows(options.tables.enemyShip, options.envUuid),
    enemySlotItem: scopeRows(options.tables.enemySlotItem, options.envUuid),
    midnightHougekiLists: scopeRows(options.tables.midnightHougekiLists, options.envUuid),
    midnightHougekis: scopeRows(options.tables.midnightHougekis, options.envUuid),
    openingTaisenLists: scopeRows(options.tables.openingTaisenLists, options.envUuid),
    openingTaisens: scopeRows(options.tables.openingTaisens, options.envUuid),
    hougekiLists: scopeRows(options.tables.hougekiLists, options.envUuid),
    hougekis: scopeRows(options.tables.hougekis, options.envUuid),
    openingAirattackLists: scopeRows(options.tables.openingAirattackLists, options.envUuid),
    openingAirattacks: scopeRows(options.tables.openingAirattacks, options.envUuid),
    openingRaigeki: scopeRows(options.tables.openingRaigeki, options.envUuid),
    closingRaigeki: scopeRows(options.tables.closingRaigeki, options.envUuid),
    airbaseAssault: scopeRows(options.tables.airbaseAssault, options.envUuid),
    airbaseAirattackLists: scopeRows(options.tables.airbaseAirattackLists, options.envUuid),
    airbaseAirattacks: scopeRows(options.tables.airbaseAirattacks, options.envUuid),
    carrierbaseAssault: scopeRows(options.tables.carrierbaseAssault, options.envUuid),
    supportHourai: scopeRows(options.tables.supportHourai, options.envUuid),
    supportAirattack: scopeRows(options.tables.supportAirattack, options.envUuid),
    nightSupportHourai: scopeRows(options.tables.nightSupportHourai, options.envUuid),
    nightSupportAirattack: scopeRows(options.tables.nightSupportAirattack, options.envUuid),
    friendlySupportHouraiLists: scopeRows(options.tables.friendlySupportHouraiLists, options.envUuid),
    friendlySupportHourai: scopeRows(options.tables.friendlySupportHourai, options.envUuid),
    destructionBattle: scopeRows(options.tables.destructionBattle, options.envUuid)
  };
  const scopedBattles = scopedTables.battle;
  const battle = context.battle;
  const cell = context.cell;
  let unresolvedReferences = 0;
  const listAndDetail = (listRows, detailRows, reference, detailField) => {
    const list = resolveLinked(listRows, reference, options.battleIndex);
    const detailUuid = String(list?.[detailField] ?? "");
    const details = rowsByUuid(detailRows, detailUuid);
    if (!list && reference) unresolvedReferences += 1;
    return { list, details };
  };
  const midnight = listAndDetail(scopedTables.midnightHougekiLists, scopedTables.midnightHougekis, battle["midnight_hougeki"], "midnight_hougeki");
  const openingTaisen = listAndDetail(scopedTables.openingTaisenLists, scopedTables.openingTaisens, battle["opening_taisen"], "opening_taisen");
  const hougeki = listAndDetail(scopedTables.hougekiLists, scopedTables.hougekis, battle["hougeki"], "hougeki");
  const openingAirattack = listAndDetail(scopedTables.openingAirattackLists, scopedTables.openingAirattacks, battle["opening_air_attack"], "opening_air_attack");
  const linkedValue = (row) => row ? [row] : [];
  const resolve = (rows, reference) => {
    const value = resolveLinked(rows, reference, options.battleIndex);
    if (!value && reference) unresolvedReferences += 1;
    return value;
  };
  const resolveDestructionBattle = (reference) => {
    const referencedRows = typeof reference === "string" ? rowsByUuid(scopedTables.destructionBattle, reference) : [];
    const value = referencedRows.find(
      (row) => Number(row["index"] ?? Number.NaN) === options.battleIndex
    );
    if (value) return value;
    if (referencedRows.length === 0 && !reference) {
      return firstByIndex(scopedTables.destructionBattle, options.battleIndex);
    }
    if (!value && reference && referencedRows.length === 0) unresolvedReferences += 1;
    return null;
  };
  const battleResult = resolve(scopedTables.battleResult, battle["battle_result"]);
  const openingRaigeki = resolve(scopedTables.openingRaigeki, battle["opening_raigeki"]);
  const closingRaigeki = resolve(scopedTables.closingRaigeki, battle["closing_raigeki"]);
  const airbaseAssault = resolve(scopedTables.airbaseAssault, battle["air_base_assault"]);
  const airbaseList = resolve(scopedTables.airbaseAirattackLists, battle["air_base_air_attacks"]);
  const airbaseAttackUuids = groupIds(airbaseList?.["air_base_air_attack"]);
  const airbaseAttacks = airbaseAttackUuids.flatMap(
    (uuid) => rowsByUuid(scopedTables.airbaseAirattacks, uuid)
  );
  const carrierbaseAssault = resolve(scopedTables.carrierbaseAssault, battle["carrier_base_assault"]);
  const supportHourai = resolve(scopedTables.supportHourai, battle["support_hourai"]);
  const supportAirattack = resolve(scopedTables.supportAirattack, battle["support_airattack"]);
  const nightSupportHourai = resolve(scopedTables.nightSupportHourai, battle["night_support_hourai"]);
  const nightSupportAirattack = resolve(scopedTables.nightSupportAirattack, battle["night_support_airattack"]);
  const destructionBattle = resolveDestructionBattle(cell?.["destruction_battles"]);
  const friendlyList = resolve(scopedTables.friendlySupportHouraiLists, battle["friendly_force_attack"]);
  const friendlySupport = resolve(scopedTables.friendlySupportHourai, friendlyList?.["friendly_support_hourai"]);
  const mergedBattle = {
    ...battle,
    timestamp: normalizeTimestamp(battle["timestamp"]) ?? normalizeTimestamp(battle["midnight_timestamp"]),
    maparea_id: normalizePositiveMapCoordinate(cell?.["maparea_id"]) ?? normalizePositiveMapCoordinate(battle["maparea_id"]),
    mapinfo_no: normalizePositiveMapCoordinate(cell?.["mapinfo_no"]) ?? normalizePositiveMapCoordinate(battle["mapinfo_no"]),
    battle_result: battleResult ?? battle["battle_result"] ?? null,
    opening_raigeki: openingRaigeki ?? battle["opening_raigeki"] ?? null,
    closing_raigeki: closingRaigeki ?? battle["closing_raigeki"] ?? null,
    support_hourai: supportHourai,
    support_airattack: supportAirattack,
    support_attack: supportHourai || supportAirattack ? { support_hourai: supportHourai, support_airatack: supportAirattack } : null,
    night_support_hourai: nightSupportHourai,
    night_support_airattack: nightSupportAirattack,
    night_support_attack: nightSupportHourai || nightSupportAirattack ? { hourai: nightSupportHourai, airatack: nightSupportAirattack } : null,
    friendly_force_attack: friendlySupport ? {
      fleet_info: battle["friendly_force_attack"] && typeof battle["friendly_force_attack"] === "object" ? battle["friendly_force_attack"]["fleet_info"] ?? null : null,
      support_hourai: friendlySupport
    } : battle["friendly_force_attack"] ?? null,
    midnight_hougeki: midnight.details.length > 0 ? midnight.details : battle["midnight_hougeki"],
    opening_taisen: openingTaisen.details.length > 0 ? openingTaisen.details : battle["opening_taisen"],
    hougeki: hougeki.details.length > 0 ? hougeki.details : battle["hougeki"],
    opening_air_attack: openingAirattack.details.length > 0 ? openingAirattack.details : battle["opening_air_attack"],
    air_base_assault: airbaseAssault ?? battle["air_base_assault"] ?? null,
    air_base_air_attacks: airbaseList ? { ...airbaseList, attacks: airbaseAttacks } : battle["air_base_air_attacks"] ?? null,
    carrier_base_assault: carrierbaseAssault ?? battle["carrier_base_assault"] ?? null,
    destruction_battle: destructionBattle
  };
  const ownShips = fleetRows(mergedBattle, scopedTables.ownDeck, scopedTables.ownShip, scopedTables.ownSlotItem, "own");
  const enemyShips = fleetRows(mergedBattle, scopedTables.enemyDeck, scopedTables.enemyShip, scopedTables.enemySlotItem, "enemy");
  const relevantShipIds = /* @__PURE__ */ new Set();
  for (const row of [...scopedTables.ownShip, ...scopedTables.enemyShip]) {
    const shipId = Number(row["ship_id"] ?? row["mst_ship_id"] ?? 0);
    if (shipId > 0) relevantShipIds.add(shipId);
  }
  const dropShipId = Number(battleResult?.["drop_ship_id"] ?? 0);
  if (dropShipId > 0) relevantShipIds.add(dropShipId);
  const relevantSlotItemIds = /* @__PURE__ */ new Set();
  for (const row of [...scopedTables.ownSlotItem, ...scopedTables.enemySlotItem]) {
    const slotItemId = Number(row["mst_slotitem_id"] ?? 0);
    if (slotItemId > 0) relevantSlotItemIds.add(slotItemId);
  }
  for (const attack of airBaseAttackRows(mergedBattle["air_base_air_attacks"])) {
    addPositiveIds(attack["squadron_plane"], relevantSlotItemIds);
  }
  if (mergedBattle["air_base_assault"] && typeof mergedBattle["air_base_assault"] === "object") {
    addPositiveIds(
      mergedBattle["air_base_assault"]["squadron_plane"],
      relevantSlotItemIds
    );
  }
  const filteredMasterShips = (options.masterShips ?? []).filter(
    (row) => relevantShipIds.has(Number(row["id"] ?? 0))
  );
  const filteredMasterSlotItems = (options.masterSlotItems ?? []).filter(
    (row) => relevantSlotItemIds.has(Number(row["id"] ?? 0))
  );
  const payload = {
    success: true,
    period_tag: options.periodTag,
    table_version: options.tableVersion ?? null,
    battle_indexes: battleIndexes(scopedBattles, cell),
    battle: mergedBattle,
    linked: {
      cells: cell ? [cell] : [],
      battle_result: linkedValue(battleResult),
      own_deck: scopedTables.ownDeck,
      own_ship: scopedTables.ownShip,
      own_slotitem: scopedTables.ownSlotItem,
      enemy_deck: scopedTables.enemyDeck,
      enemy_ship: scopedTables.enemyShip,
      enemy_slotitem: scopedTables.enemySlotItem,
      midnight_hougeki_list: linkedValue(midnight.list),
      midnight_hougeki: midnight.details,
      opening_taisen_list: linkedValue(openingTaisen.list),
      opening_taisen: openingTaisen.details,
      hougeki_list: linkedValue(hougeki.list),
      hougeki: hougeki.details,
      opening_airattack_list: linkedValue(openingAirattack.list),
      opening_airattack: openingAirattack.details,
      opening_raigeki: linkedValue(openingRaigeki),
      closing_raigeki: linkedValue(closingRaigeki),
      destruction_battle: linkedValue(destructionBattle),
      airbase_assult: linkedValue(airbaseAssault),
      airbase_airattack_list: linkedValue(airbaseList),
      airbase_airattack: airbaseAttacks,
      carrierbase_assault: linkedValue(carrierbaseAssault),
      support_hourai: linkedValue(supportHourai),
      support_airattack: linkedValue(supportAirattack),
      night_support_hourai: linkedValue(nightSupportHourai),
      night_support_airattack: linkedValue(nightSupportAirattack),
      friendly_support_hourai_list: linkedValue(friendlyList),
      friendly_support_hourai: linkedValue(friendlySupport)
    },
    refs: {
      mst_ship: filteredMasterShips,
      mst_slotitem: filteredMasterSlotItems,
      weapon_icon_frames: options.weaponIconFrames
    },
    derived: {
      friendly_fleet: indexedFleet(ownShips, options.masterShips ?? [], options.masterSlotItems ?? [], "own"),
      enemy_fleet: indexedFleet(enemyShips, options.masterShips ?? [], options.masterSlotItems ?? [], "enemy")
    },
    source_meta: { env_uuid: options.envUuid, battle_index: options.battleIndex }
  };
  return {
    payload,
    duplicateBattleIndexes: context.duplicateBattleIndexes,
    unresolvedReferences
  };
}

// scripts/rebuild-all-snapshots.ts
async function rebuildAllSnapshots(options) {
  const periodTag = options?.periodTag || "2026-10-14";
  const tableVersion = options?.tableVersion || "0.6.0";
  const bucketName = "dev-kc-battle-data";
  console.log(`[rebuild-snapshots] Rebuilding all snapshots for period: ${periodTag}, tableVersion: ${tableVersion}`);
  console.log("[rebuild-snapshots] Fetching master data...");
  const base = "https://fusou.ogu-hide-u-425.workers.dev";
  const [shipRes, slotRes] = await Promise.all([
    fetch(`${base}/api/master-data/json?table_name=mst_ship`),
    fetch(`${base}/api/master-data/json?table_name=mst_slotitem`)
  ]);
  const shipJson = await shipRes.json();
  const slotJson = await slotRes.json();
  const masterShips = shipJson.records || [];
  const masterSlotItems = slotJson.records || [];
  console.log(`[rebuild-snapshots] Loaded ${masterShips.length} master ships and ${masterSlotItems.length} master slot items.`);
  if (masterShips.length === 0 || masterSlotItems.length === 0) {
    throw new Error("Master data could not be fetched or is empty!");
  }
  console.log("[rebuild-snapshots] Finding period Avro files in D1...");
  const d1Output = execSync(
    `pnpm --filter fusou-web exec wrangler d1 execute dev-kc-battle-index --remote --json --command "SELECT file_path FROM archived_files WHERE file_path LIKE '%/${periodTag}/period/%' AND file_path NOT LIKE 'compacted/%'"`,
    { encoding: "utf-8" }
  );
  const d1Parsed = JSON.parse(d1Output);
  const filePaths = (d1Parsed[0]?.results || []).map((r) => r.file_path);
  console.log(`[rebuild-snapshots] Found ${filePaths.length} period files for ${periodTag}.`);
  const tempDir = path.resolve("./temp_rebuild_snapshots");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const tableRecords = {};
  for (const fp of filePaths) {
    const match = fp.match(/\/([^/]+)-001\.avro$/) || fp.match(/\/([^/]+)\.avro$/);
    if (!match) continue;
    const tableName = match[1];
    const localFile = path.join(tempDir, `${tableName}.avro`);
    execSync(
      `pnpm --filter fusou-web exec wrangler r2 object get ${bucketName}/${fp} --file ${localFile} --remote`,
      { stdio: "ignore" }
    );
    const buf = fs.readFileSync(localFile);
    tableRecords[tableName] = decodeAvroOcfToJson(buf);
    fs.unlinkSync(localFile);
  }
  const detailTables = {
    battle: tableRecords["battle"] || [],
    cells: tableRecords["cells"] || [],
    battleResult: tableRecords["battle_result"] || [],
    ownDeck: tableRecords["own_deck"] || [],
    ownShip: tableRecords["own_ship"] || [],
    ownSlotItem: tableRecords["own_slotitem"] || [],
    enemyDeck: tableRecords["enemy_deck"] || [],
    enemyShip: tableRecords["enemy_ship"] || [],
    enemySlotItem: tableRecords["enemy_slotitem"] || [],
    midnightHougekiLists: tableRecords["midnight_hougeki_list"] || [],
    midnightHougekis: tableRecords["midnight_hougeki"] || [],
    openingTaisenLists: tableRecords["opening_taisen_list"] || [],
    openingTaisens: tableRecords["opening_taisen"] || [],
    hougekiLists: tableRecords["hougeki_list"] || [],
    hougekis: tableRecords["hougeki"] || [],
    openingAirattackLists: tableRecords["opening_airattack_list"] || [],
    openingAirattacks: tableRecords["opening_airattack"] || [],
    openingRaigeki: tableRecords["opening_raigeki"] || [],
    closingRaigeki: tableRecords["closing_raigeki"] || [],
    airbaseAssault: tableRecords["airbase_assault"] || [],
    airbaseAirattackLists: tableRecords["airbase_airattack_list"] || [],
    airbaseAirattacks: tableRecords["airbase_airattack"] || [],
    carrierbaseAssault: tableRecords["carrierbase_assault"] || [],
    supportHourai: tableRecords["support_hourai"] || [],
    supportAirattack: tableRecords["support_airattack"] || [],
    nightSupportHourai: tableRecords["night_support_hourai"] || [],
    nightSupportAirattack: tableRecords["night_support_airattack"] || [],
    friendlySupportHouraiLists: tableRecords["friendly_support_hourai_list"] || [],
    friendlySupportHourai: tableRecords["friendly_support_hourai"] || [],
    destructionBattle: tableRecords["destruction_battle"] || []
  };
  const battles = detailTables.battle;
  const uniqueEnvUuids = Array.from(new Set(battles.map((b) => String(b.env_uuid || "")).filter(Boolean)));
  console.log(`[rebuild-snapshots] Processing ${uniqueEnvUuids.length} unique sorties...`);
  const uploadTasks = [];
  for (const envUuid of uniqueEnvUuids) {
    const envBattles = battles.filter((b) => b.env_uuid === envUuid).sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
    const envBattlePayloads = {};
    for (const b of envBattles) {
      const battleIndex = Number(b.index ?? 0);
      const resolution = resolveBattleDetail({
        periodTag,
        tableVersion,
        envUuid,
        battleIndex,
        masterShips,
        masterSlotItems,
        tables: detailTables
      });
      if (resolution) {
        envBattlePayloads[String(battleIndex)] = resolution.payload;
        const battleJson = JSON.stringify(resolution.payload);
        const battleBr = zlib.brotliCompressSync(Buffer.from(battleJson, "utf-8"), {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }
        });
        const battleFile = path.join(tempDir, `${envUuid}_${battleIndex}.json.br`);
        fs.writeFileSync(battleFile, battleBr);
        uploadTasks.push(
          { key: `snapshots/detail/${periodTag}/${envUuid}_${battleIndex}.json.br`, localFile: battleFile },
          { key: `snapshots/detail/latest/${envUuid}_${battleIndex}.json.br`, localFile: battleFile }
        );
      }
    }
    const bundle = {
      success: true,
      env_uuid: envUuid,
      period_tag: periodTag,
      table_version: tableVersion,
      snapshot_timestamp: Date.now(),
      battles: envBattlePayloads
    };
    const bundleJson = JSON.stringify(bundle);
    const bundleBr = zlib.brotliCompressSync(Buffer.from(bundleJson, "utf-8"), {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }
    });
    const bundleFile = path.join(tempDir, `${envUuid}_bundle.json.br`);
    fs.writeFileSync(bundleFile, bundleBr);
    uploadTasks.push(
      { key: `snapshots/env_detail/${periodTag}/${envUuid}.json.br`, localFile: bundleFile },
      { key: `snapshots/env_detail/latest/${envUuid}.json.br`, localFile: bundleFile }
    );
  }
  console.log("[rebuild-snapshots] Building Overview and Drops snapshots...");
  const sortiesForOverview = uniqueEnvUuids.map((envUuid) => {
    const sBattles = battles.filter((b) => b.env_uuid === envUuid);
    const sCells = detailTables.cells.filter((c) => c.env_uuid === envUuid);
    const sResults = detailTables.battleResult.filter((r) => r.env_uuid === envUuid);
    const sEnemyDecks = detailTables.enemyDeck.filter((d) => d.env_uuid === envUuid);
    const sEnemyShips = detailTables.enemyShip.filter((s) => s.env_uuid === envUuid);
    const firstTs = Number(sBattles[0]?.timestamp || Date.now());
    return {
      env_uuid: envUuid,
      period_tag: periodTag,
      table_version: tableVersion,
      timestamp: firstTs,
      cells: sCells,
      battles: sBattles,
      battleResults: sResults,
      enemyDecks: sEnemyDecks,
      enemyShips: sEnemyShips
    };
  });
  const overviewPayload = buildOverviewSnapshot(sortiesForOverview, { periodTag });
  const overviewJson = JSON.stringify(overviewPayload);
  const overviewBr = zlib.brotliCompressSync(Buffer.from(overviewJson, "utf-8"), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }
  });
  const overviewFile = path.join(tempDir, "overview.json.br");
  fs.writeFileSync(overviewFile, overviewBr);
  const dropsPayload = buildDropsSnapshot(sortiesForOverview, { periodTag });
  dropsPayload.mst_ships = masterShips;
  const dropsJson = JSON.stringify(dropsPayload);
  const dropsBr = zlib.brotliCompressSync(Buffer.from(dropsJson, "utf-8"), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 }
  });
  const dropsFile = path.join(tempDir, "drops.json.br");
  fs.writeFileSync(dropsFile, dropsBr);
  uploadTasks.push(
    { key: `snapshots/overview/${periodTag}/latest.json.br`, localFile: overviewFile },
    { key: `snapshots/overview/latest/latest.json.br`, localFile: overviewFile },
    { key: `snapshots/drops/${periodTag}/latest.json.br`, localFile: dropsFile },
    { key: `snapshots/drops/latest/latest.json.br`, localFile: dropsFile }
  );
  console.log(`[rebuild-snapshots] Uploading ${uploadTasks.length} snapshot files to R2 bucket ${bucketName}...`);
  for (let i = 0; i < uploadTasks.length; i++) {
    const task = uploadTasks[i];
    execSync(
      `pnpm --filter fusou-web exec wrangler r2 object put ${bucketName}/${task.key} --file ${task.localFile} --remote`,
      { stdio: "ignore" }
    );
    if ((i + 1) % 20 === 0 || i === uploadTasks.length - 1) {
      console.log(`[rebuild-snapshots] Uploaded ${i + 1}/${uploadTasks.length} files...`);
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("[rebuild-snapshots] All snapshots rebuilt and uploaded successfully!");
}
if (process.argv[1]?.includes("rebuild-all-snapshots")) {
  rebuildAllSnapshots().catch((err) => {
    console.error("[rebuild-snapshots] Failed:", err);
    process.exit(1);
  });
}
export {
  rebuildAllSnapshots
};
