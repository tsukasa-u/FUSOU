import {
  AvroOcfError,
  decodeAvroOcfToJson,
  type AvroJsonRecord,
} from "@/features/avro/ocf-decoder";
import { parseOcfHeader, type OcfHeader } from "@/features/avro/ocf-header";
import {
  LocalAvroPathError,
  parseLocalAvroPath,
} from "../local-directory/manifest";
import {
  PUBLIC_RECORD_TABLES,
} from "../contracts";
import { buildBattleDropsPayload } from "../resolvers/drops";
import { buildBattleOverviewPayload } from "../resolvers/overview";
import {
  findBattleDetailContext,
  resolveBattleDetail,
  type BattleDetailTables,
} from "../resolvers/detail";
import {
  LocalBattleError,
  type LocalManifestEntry,
  type ProgressPhase,
  type SerializableManifest,
  type WorkerDropsQuery,
  type WorkerDetailQuery,
  type WorkerOverviewQuery,
  type WorkerRecordQuery,
} from "./protocol";
import { buildTableIndex, type TableIndex } from "./indexes";
import { expectedSchemaNameForTable } from "./schema-registry";
import {
  MAX_DECODE_CONCURRENCY,
  MAX_FILE_BYTES,
  MAX_MANIFEST_FILES,
  MAX_QUERY_RECORDS,
} from "../local-directory/limits";

export type WorkerProgressReporter = (
  phase: ProgressPhase,
  completed: number,
  total: number,
  label?: string,
  details?: {
    completedBytes: number;
    totalBytes: number;
    records: number;
  },
) => void;

type CachedTable = {
  key: string;
  index: TableIndex;
};

type RowMatcher = (row: AvroJsonRecord) => boolean;

function asLocalBattleError(error: unknown): LocalBattleError {
  if (error instanceof LocalBattleError) return error;
  if (error instanceof AvroOcfError) {
    return new LocalBattleError(error.code, error.message);
  }
  if (error instanceof LocalAvroPathError) {
    return new LocalBattleError(
      error.code === "UNKNOWN_TABLE" ? "UNKNOWN_SCHEMA" : error.code,
      error.message,
    );
  }
  return new LocalBattleError(
    "CORRUPT_AVRO",
    "ローカル AVRO の読み取りに失敗しました。",
  );
}

function compareEntries(left: LocalManifestEntry, right: LocalManifestEntry): number {
  return (
    right.periodTag.localeCompare(left.periodTag) ||
    Number(left.mapAreaId ?? 0) - Number(right.mapAreaId ?? 0) ||
    Number(left.mapInfoNo ?? 0) - Number(right.mapInfoNo ?? 0) ||
    left.table.localeCompare(right.table) ||
    Number(right.fileTimestamp ?? right.lastModified) -
      Number(left.fileTimestamp ?? left.lastModified)
  );
}

function hasReference(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function referenceIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
  }
  return typeof value === "string" && value.length > 0 ? [value] : [];
}

function findReferencedRow(
  rows: AvroJsonRecord[],
  reference: unknown,
  battleIndex: number,
): AvroJsonRecord | null {
  const referenceUuid = typeof reference === "string" ? reference : "";
  return (
    rows.find((row) => referenceUuid && String(row.uuid ?? "") === referenceUuid) ??
    rows.find((row) => Number(row.index ?? Number.NaN) === battleIndex) ??
    null
  );
}

function detailReference(
  rows: AvroJsonRecord[],
  reference: unknown,
  battleIndex: number,
  field: string,
): string | null {
  const value = findReferencedRow(rows, reference, battleIndex)?.[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function matchesRecordFilter(
  record: AvroJsonRecord,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  for (const [key, expected] of Object.entries(filter)) {
    const actual = record[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
      continue;
    }
    if (expected === null) {
      if (actual !== null && actual !== undefined) return false;
      continue;
    }
    if (typeof expected === "number") {
      const actualNumber = Number(actual);
      if (!Number.isFinite(actualNumber) || actualNumber !== expected) return false;
      continue;
    }
    if (typeof expected === "boolean") {
      if (Boolean(actual) !== expected) return false;
      continue;
    }
    if (String(actual) !== String(expected)) return false;
  }
  return true;
}

function validateManifestEntry(entry: LocalManifestEntry): void {
  if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
    throw new LocalBattleError("INVALID_DIRECTORY_LAYOUT", "AVRO file size is invalid");
  }
  if (entry.size > MAX_FILE_BYTES) {
    throw new LocalBattleError("FILE_TOO_LARGE", "ローカル AVRO ファイルが上限を超えています。");
  }
  if (!entry.relativePath || entry.relativePath.startsWith("/")) {
    throw new LocalBattleError("INVALID_DIRECTORY_LAYOUT", "AVRO path is invalid");
  }
  const parsed = parseLocalAvroPath(entry.relativePath);
  if (
    parsed.periodTag !== entry.periodTag ||
    parsed.storageKind !== entry.storageKind ||
    parsed.table !== entry.table
  ) {
    throw new LocalBattleError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO manifest and path metadata do not match",
    );
  }
}

async function readEntry(entry: LocalManifestEntry): Promise<Uint8Array> {
  if (entry.file) return new Uint8Array(await entry.file.arrayBuffer());
  if (entry.handle) {
    try {
      return new Uint8Array(await (await entry.handle.getFile()).arrayBuffer());
    } catch {
      throw new LocalBattleError(
        "PERMISSION_DENIED",
        "ローカル AVRO への読み取り権限がありません。",
      );
    }
  }
  throw new LocalBattleError(
    "PERMISSION_REQUIRED",
    "ローカル AVRO ファイルを読み取るための handle がありません。",
  );
}

function validateSchema(table: string, bytes: Uint8Array): void {
  const expected = expectedSchemaNameForTable(table);
  if (!expected) {
    throw new LocalBattleError("UNKNOWN_SCHEMA", "AVRO table schema is not supported");
  }
  let header: OcfHeader;
  try {
    header = parseOcfHeader(bytes);
  } catch (error) {
    throw asLocalBattleError(error);
  }
  if (header.codec !== null && header.codec !== "null") {
    throw new LocalBattleError(
      "UNSUPPORTED_CODEC",
      "この AVRO codec はブラウザでサポートされていません。",
    );
  }
  if (header.schema.name !== expected) {
    throw new LocalBattleError(
      "SCHEMA_PATH_MISMATCH",
      "AVRO path table と embedded schema が一致しません。",
      { table, schemaName: String(header.schema.name ?? "") },
    );
  }
}

export class LocalWorkerSession {
  private manifest: SerializableManifest | null = null;
  private readonly cache = new Map<string, CachedTable>();
  private readonly pending = new Map<string, Promise<TableIndex>>();
  private readonly cancelled = new Set<string>();
  private disposed = false;

  initialize(manifest: SerializableManifest): {
    fingerprint: string;
    fileCount: number;
  } {
    if (manifest.entries.length > MAX_MANIFEST_FILES) {
      throw new LocalBattleError(
        "FILE_LIMIT_EXCEEDED",
        "ローカル AVRO のファイル数が上限を超えています。",
      );
    }

    const ids = new Set<string>();
    for (const entry of manifest.entries) {
      if (ids.has(entry.id)) {
        throw new LocalBattleError(
          "INVALID_DIRECTORY_LAYOUT",
          "ローカル AVRO manifest に重複ファイルがあります。",
        );
      }
      ids.add(entry.id);
      validateManifestEntry(entry);
    }
    if (!manifest.entries.some((entry) => entry.table === "battle")) {
      throw new LocalBattleError(
        "NO_BATTLE_DATA",
        "ローカル AVRO に battle table がありません。",
      );
    }

    this.cache.clear();
    this.pending.clear();
    this.cancelled.clear();
    this.manifest = manifest;
    this.disposed = false;
    return { fingerprint: manifest.fingerprint, fileCount: manifest.entries.length };
  }

  listPeriods(table: string) {
    this.ensureReady();
    this.ensurePublicTable(table);
    const periods = new Set(
      this.manifest!.entries
        .filter((entry) => entry.storageKind === "transaction_data" && entry.table === table)
        .map((entry) => entry.periodTag),
    );
    return [...periods]
      .sort((left, right) => right.localeCompare(left))
      .map((periodTag) => ({ periodTag, tableVersion: null }));
  }

  async records(
    requestId: string,
    query: WorkerRecordQuery,
    reportProgress: WorkerProgressReporter,
  ) {
    this.ensureReady();
    this.ensurePublicTable(query.table);
    if (query.tier && query.tier !== "period") {
      throw new LocalBattleError(
        "INVALID_DIRECTORY_LAYOUT",
        "ローカル AVRO は period tier のみサポートします。",
      );
    }
    const limit = query.limitRecords ?? MAX_QUERY_RECORDS;
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_QUERY_RECORDS) {
      throw new LocalBattleError(
        "OUT_OF_MEMORY_GUARD",
        "ローカル AVRO query の record limit が上限を超えています。",
      );
    }

    const records = await this.loadRows(
      query.table,
      query.periodTag,
      requestId,
      reportProgress,
    );
    const filtered = records.filter((record) => matchesRecordFilter(record, query.filter));
    const limited = filtered.slice(0, limit);
    return {
      success: true,
      table: query.table,
      period_tag: query.periodTag,
      table_version: null,
      count: limited.length,
      records: limited,
    };
  }

  async overview(
    requestId: string,
    query: WorkerOverviewQuery,
    reportProgress: WorkerProgressReporter,
  ) {
    this.ensureReady();
    const [battles, cells, battleResults] = await Promise.all([
      this.loadRows("battle", query.periodTag, requestId, reportProgress),
      this.loadOptionalRows("cells", query.periodTag, requestId, reportProgress),
      this.loadOptionalRows("battle_result", query.periodTag, requestId, reportProgress),
    ]);
    const deckIds = new Set(
      battles
        .map((battle) => (typeof battle.e_deck_id === "string" ? battle.e_deck_id : ""))
        .filter(Boolean),
    );
    const allEnemyDecks = await this.loadOptionalRows(
      "enemy_deck",
      "all",
      requestId,
      reportProgress,
    );
    const enemyDecks = allEnemyDecks.filter((deck) => deckIds.has(String(deck.uuid ?? "")));
    const shipGroupIds = new Set(
      enemyDecks.flatMap((deck) =>
        Array.isArray(deck.ship_ids)
          ? deck.ship_ids.filter((id): id is string => typeof id === "string")
          : typeof deck.ship_ids === "string"
            ? [deck.ship_ids]
            : [],
      ),
    );
    const allEnemyShips = await this.loadOptionalRows(
      "enemy_ship",
      "all",
      requestId,
      reportProgress,
    );
    const enemyShips = allEnemyShips.filter((ship) => shipGroupIds.has(String(ship.uuid ?? "")));

    return buildBattleOverviewPayload({
      periodTag: query.periodTag,
      tableVersion: null,
      battles,
      cells,
      battleResults,
      mstShips: query.masterShips,
      enemyDecks,
      enemyShips,
    });
  }

  async drops(
    requestId: string,
    query: WorkerDropsQuery,
    reportProgress: WorkerProgressReporter,
  ) {
    this.ensureReady();
    const [battles, cells, battleResults] = await Promise.all([
      this.loadRows("battle", query.periodTag, requestId, reportProgress),
      this.loadOptionalRows("cells", query.periodTag, requestId, reportProgress),
      this.loadOptionalRows("battle_result", query.periodTag, requestId, reportProgress),
    ]);
    return buildBattleDropsPayload({
      periodTag: query.periodTag,
      tableVersion: null,
      battles,
      cells,
      battleResults,
      mstShips: query.masterShips || [],
    });
  }

  async detail(
    requestId: string,
    query: WorkerDetailQuery,
    reportProgress: WorkerProgressReporter,
  ) {
    this.ensureReady();
    if (!query.envUuid || !Number.isSafeInteger(query.battleIndex) || query.battleIndex < 0) {
      throw new LocalBattleError(
        "BATTLE_NOT_FOUND",
        "env_uuid または battle_index が不正です。",
      );
    }

    const load = (table: string, references: unknown[] = []) =>
      this.loadDetailRows(
        table,
        query.periodTag,
        query.envUuid,
        query.battleIndex,
        references,
        requestId,
        reportProgress,
      );
    const [battle, cells] = await Promise.all([
      this.loadDetailRows(
        "battle",
        query.periodTag,
        query.envUuid,
        query.battleIndex,
        [],
        requestId,
        reportProgress,
      ),
      load("cells"),
    ]);
    const context = findBattleDetailContext({
      tables: { battle, cells },
      envUuid: query.envUuid,
      battleIndex: query.battleIndex,
    });
    if (!context) {
      throw new LocalBattleError(
        "BATTLE_NOT_FOUND",
        "指定された env_uuid / battle_index の戦闘が見つかりませんでした。",
      );
    }

    const [
      battleResult,
      ownDeck,
      ownShip,
      ownSlotItem,
      enemyDeck,
      enemyShip,
      enemySlotItem,
      midnightHougekiLists,
      openingTaisenLists,
      hougekiLists,
      openingAirattackLists,
    ] = await Promise.all([
      hasReference(context.battle.battle_result)
        ? load("battle_result", [context.battle.battle_result])
        : Promise.resolve([]),
      load("own_deck"),
      load("own_ship"),
      load("own_slotitem"),
      hasReference(context.battle.e_deck_id)
        ? load("enemy_deck", [context.battle.e_deck_id])
        : Promise.resolve([]),
      hasReference(context.battle.e_deck_id)
        ? load("enemy_ship", [context.battle.e_deck_id])
        : Promise.resolve([]),
      hasReference(context.battle.e_deck_id)
        ? load("enemy_slotitem", [context.battle.e_deck_id])
        : Promise.resolve([]),
      load("midnight_hougeki_list", [context.battle.midnight_hougeki]),
      load("opening_taisen_list", [context.battle.opening_taisen]),
      load("hougeki_list", [context.battle.hougeki]),
      load("opening_airattack_list", [context.battle.opening_air_attack]),
    ]);

    const midnightDetailUuid = detailReference(
      midnightHougekiLists,
      context.battle.midnight_hougeki,
      query.battleIndex,
      "midnight_hougeki",
    );
    const openingTaisenDetailUuid = detailReference(
      openingTaisenLists,
      context.battle.opening_taisen,
      query.battleIndex,
      "opening_taisen",
    );
    const hougekiDetailUuid = detailReference(
      hougekiLists,
      context.battle.hougeki,
      query.battleIndex,
      "hougeki",
    );
    const openingAirattackDetailUuid = detailReference(
      openingAirattackLists,
      context.battle.opening_air_attack,
      query.battleIndex,
      "opening_air_attack",
    );
    const [
      midnightHougekis,
      openingTaisens,
      hougekis,
      openingAirattacks,
      openingRaigeki,
      closingRaigeki,
      airbaseAssault,
      airbaseAirattackLists,
      carrierbaseAssault,
      supportHourai,
      supportAirattack,
      nightSupportHourai,
      nightSupportAirattack,
      friendlySupportHouraiLists,
      destructionBattle,
    ] = await Promise.all([
      midnightDetailUuid ? load("midnight_hougeki", [midnightDetailUuid]) : Promise.resolve([]),
      openingTaisenDetailUuid ? load("opening_taisen", [openingTaisenDetailUuid]) : Promise.resolve([]),
      hougekiDetailUuid ? load("hougeki", [hougekiDetailUuid]) : Promise.resolve([]),
      openingAirattackDetailUuid ? load("opening_airattack", [openingAirattackDetailUuid]) : Promise.resolve([]),
      hasReference(context.battle.opening_raigeki)
        ? load("opening_raigeki", [context.battle.opening_raigeki])
        : Promise.resolve([]),
      hasReference(context.battle.closing_raigeki)
        ? load("closing_raigeki", [context.battle.closing_raigeki])
        : Promise.resolve([]),
      hasReference(context.battle.air_base_assault)
        ? load("airbase_assult", [context.battle.air_base_assault])
        : Promise.resolve([]),
      hasReference(context.battle.air_base_air_attacks)
        ? load("airbase_airattack_list", [context.battle.air_base_air_attacks])
        : Promise.resolve([]),
      hasReference(context.battle.carrier_base_assault)
        ? load("carrierbase_assault", [context.battle.carrier_base_assault])
        : Promise.resolve([]),
      hasReference(context.battle.support_hourai)
        ? load("support_hourai", [context.battle.support_hourai])
        : Promise.resolve([]),
      hasReference(context.battle.support_airattack)
        ? load("support_airattack", [context.battle.support_airattack])
        : Promise.resolve([]),
      hasReference(context.battle.night_support_hourai)
        ? load("night_support_hourai", [context.battle.night_support_hourai])
        : Promise.resolve([]),
      hasReference(context.battle.night_support_airattack)
        ? load("night_support_airattack", [context.battle.night_support_airattack])
        : Promise.resolve([]),
      hasReference(context.battle.friendly_force_attack)
        ? load("friendly_support_hourai_list", [context.battle.friendly_force_attack])
        : Promise.resolve([]),
      hasReference(context.cell?.destruction_battles)
        ? load("destruction_battle", [context.cell?.destruction_battles])
        : Promise.resolve([]),
    ]);
    const airbaseAttackUuids = referenceIds(
      findReferencedRow(
        airbaseAirattackLists,
        context.battle.air_base_air_attacks,
        query.battleIndex,
      )?.air_base_air_attack,
    );
    const airbaseAirattacks = airbaseAttackUuids.length
      ? await load("airbase_airattack", airbaseAttackUuids)
      : [];
    const friendlyDetailUuid = detailReference(
      friendlySupportHouraiLists,
      context.battle.friendly_force_attack,
      query.battleIndex,
      "friendly_support_hourai",
    );
    const friendlySupportHourai = friendlyDetailUuid
      ? await load("friendly_support_hourai", [friendlyDetailUuid])
      : [];
    this.throwIfCancelled(requestId);

    const tables: BattleDetailTables = {
      battle,
      cells,
      battleResult,
      ownDeck,
      ownShip,
      ownSlotItem,
      enemyDeck,
      enemyShip,
      enemySlotItem,
      midnightHougekiLists,
      midnightHougekis,
      openingTaisenLists,
      openingTaisens,
      hougekiLists,
      hougekis,
      openingAirattackLists,
      openingAirattacks,
      openingRaigeki,
      closingRaigeki,
      airbaseAssault,
      airbaseAirattackLists,
      airbaseAirattacks,
      carrierbaseAssault,
      supportHourai,
      supportAirattack,
      nightSupportHourai,
      nightSupportAirattack,
      friendlySupportHouraiLists,
      friendlySupportHourai,
      destructionBattle,
    };
    const resolved = resolveBattleDetail({
      periodTag: query.periodTag,
      tableVersion: null,
      envUuid: query.envUuid,
      battleIndex: query.battleIndex,
      masterShips: query.masterShips || [],
      masterSlotItems: query.masterSlotItems || [],
      tables,
    });
    if (!resolved) {
      throw new LocalBattleError(
        "BATTLE_NOT_FOUND",
        "指定された env_uuid / battle_index の戦闘が見つかりませんでした。",
      );
    }
    reportProgress("resolve", 1, 1, "battle detail");
    return resolved.payload;
  }

  cancel(requestId: string): void {
    this.cancelled.add(requestId);
  }

  dispose(): void {
    this.cache.clear();
    this.pending.clear();
    this.cancelled.clear();
    this.manifest = null;
    this.disposed = true;
  }

  private async loadTable(
    cacheKey: string,
    table: string,
    periodTag: string,
    requestId: string,
    reportProgress: WorkerProgressReporter,
    rowMatcher?: RowMatcher,
  ): Promise<TableIndex> {
    const cached = this.cache.get(cacheKey);
    if (cached) return cached.index;
    const existing = this.pending.get(cacheKey);
    if (existing) return existing;

    const load = this.decodeTable(table, periodTag, requestId, reportProgress, rowMatcher)
      .then((rows) => {
        const index = buildTableIndex(table, rows);
        this.cache.set(cacheKey, { key: cacheKey, index });
        return index;
      })
      .finally(() => this.pending.delete(cacheKey));
    this.pending.set(cacheKey, load);
    return load;
  }

  private async loadRows(
    table: string,
    periodTag: string,
    requestId: string,
    reportProgress: WorkerProgressReporter,
  ): Promise<AvroJsonRecord[]> {
    const index = await this.loadTable(
      this.cacheKey(table, periodTag),
      table,
      periodTag,
      requestId,
      reportProgress,
    );
    return index.rows;
  }

  private async loadDetailRows(
    table: string,
    periodTag: string,
    envUuid: string,
    battleIndex: number,
    references: unknown[],
    requestId: string,
    reportProgress: WorkerProgressReporter,
  ): Promise<AvroJsonRecord[]> {
    if (this.entriesFor(table, periodTag).length === 0) return [];
    const referenceUuids = new Set(
      references.flatMap((reference) => referenceIds(reference)),
    );
    const matcher: RowMatcher = (row) => {
      const belongsToEnvironment = String(row.env_uuid ?? "") === envUuid;
      return belongsToEnvironment || (typeof row.uuid === "string" && referenceUuids.has(row.uuid));
    };
    const fullCache = this.cache.get(this.cacheKey(table, periodTag));
    if (fullCache) return fullCache.index.rows.filter(matcher);
    const filterKey = [envUuid, battleIndex, ...[...referenceUuids].sort()].join("\0");
    const index = await this.loadTable(
      `${this.cacheKey(table, periodTag)}\0detail\0${filterKey}`,
      table,
      periodTag,
      requestId,
      reportProgress,
      matcher,
    );
    return index.rows;
  }

  private async loadOptionalRows(
    table: string,
    periodTag: string,
    requestId: string,
    reportProgress: WorkerProgressReporter,
  ): Promise<AvroJsonRecord[]> {
    if (this.entriesFor(table, periodTag).length === 0) return [];
    return this.loadRows(table, periodTag, requestId, reportProgress);
  }

  private async decodeTable(
    table: string,
    periodTag: string,
    requestId: string,
    reportProgress: WorkerProgressReporter,
    rowMatcher?: RowMatcher,
  ): Promise<AvroJsonRecord[]> {
    const entries = this.entriesFor(table, periodTag);
    if (entries.length === 0) {
      throw new LocalBattleError(
        "NO_BATTLE_DATA",
        "指定された local AVRO table がありません。",
        { table, periodTag, phase: "file-discovery" },
      );
    }
    const rows: AvroJsonRecord[] = [];
    let nextEntry = 0;
    let completedEntries = 0;
    let completedBytes = 0;
    let decoded = 0;
    const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    const decodeOne = async () => {
      while (nextEntry < entries.length) {
        this.throwIfCancelled(requestId);
        const entry = entries[nextEntry++];
        try {
          const bytes = await readEntry(entry);
          if (bytes.byteLength > MAX_FILE_BYTES) {
            throw new LocalBattleError("FILE_TOO_LARGE", "ローカル AVRO ファイルが上限を超えています。");
          }
          validateSchema(table, bytes);
          const decodedRows = decodeAvroOcfToJson(bytes);
          const matchedRows = rowMatcher ? decodedRows.filter(rowMatcher) : decodedRows;
          decoded += matchedRows.length;
          if (decoded > MAX_QUERY_RECORDS) {
            throw new LocalBattleError(
              "OUT_OF_MEMORY_GUARD",
              "local AVRO query の decoded record 数が上限を超えています。",
            );
          }
          rows.push(...matchedRows);
          completedEntries += 1;
          completedBytes += entry.size;
          reportProgress("decode", completedEntries, entries.length, table, {
            completedBytes,
            totalBytes,
            records: rows.length,
          });
        } catch (error) {
          const localError = asLocalBattleError(error);
          throw new LocalBattleError(localError.code, localError.message, {
            ...localError.details,
            table,
            periodTag,
            phase: "decode",
            relativePath: entry.relativePath,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_DECODE_CONCURRENCY, entries.length) }, decodeOne),
    );
    this.throwIfCancelled(requestId);
    reportProgress("index", 1, 1, table, {
      completedBytes: totalBytes,
      totalBytes,
      records: rows.length,
    });
    return rows;
  }

  private entriesFor(table: string, periodTag: string): LocalManifestEntry[] {
    const entries = this.manifest!.entries.filter(
      (entry) => entry.storageKind === "transaction_data" && entry.table === table,
    );
    if (periodTag === "all") return entries.sort(compareEntries);
    if (periodTag === "latest") {
      const latest = entries.reduce(
        (value, entry) => (entry.periodTag > value ? entry.periodTag : value),
        "",
      );
      return entries.filter((entry) => entry.periodTag === latest).sort(compareEntries);
    }
    return entries.filter((entry) => entry.periodTag === periodTag).sort(compareEntries);
  }

  private cacheKey(table: string, periodTag: string): string {
    return `${this.manifest!.fingerprint}/period/${periodTag}/${table}`;
  }

  private ensureReady(): void {
    if (this.disposed || !this.manifest) {
      throw new LocalBattleError("PERMISSION_REQUIRED", "ローカル AVRO source が初期化されていません。");
    }
  }

  private ensurePublicTable(table: string): void {
    if (!PUBLIC_RECORD_TABLES.has(table)) {
      throw new LocalBattleError("UNKNOWN_SCHEMA", "指定された local AVRO table は公開 record ではありません。");
    }
  }

  private throwIfCancelled(requestId: string): void {
    if (this.cancelled.has(requestId)) {
      this.cancelled.delete(requestId);
      throw new LocalBattleError("CANCELLED", "ローカル AVRO query がキャンセルされました。");
    }
  }
}