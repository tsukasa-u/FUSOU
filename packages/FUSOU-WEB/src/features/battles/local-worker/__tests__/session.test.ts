import { describe, expect, it, vi } from "vitest";
import * as ocfDecoder from "@/features/avro/ocf-decoder";
import {
  battleFixtureBytes,
  enemyDeckFixtureBytes,
  enemyShipFixtureBytes,
} from "@/features/avro/test-fixtures";
import {
  createLocalAvroFileEntry,
  parseLocalAvroPath,
  type LocalAvroFileEntry,
} from "../../local-directory/manifest";
import { LocalBattleError } from "../protocol";
import { LocalWorkerSession } from "../session";

const relativePath =
  "fusou/2026-07-08/transaction_data/5-4/battle/1785499200_4c78c801-1d64-4e66-bcac-82025884b215.avro";
const enemyDeckPath = relativePath.replace("/battle/", "/enemy_deck/");
const enemyShipPath = relativePath.replace("/battle/", "/enemy_ship/");

function entryFor(
  path: string,
  bytes: Uint8Array,
  tableVersion?: string,
): LocalAvroFileEntry & { file: File } {
  const entry = createLocalAvroFileEntry(parseLocalAvroPath(path), {
    size: bytes.byteLength,
    lastModified: 1,
    ...(tableVersion === undefined ? {} : { tableVersion }),
  });
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return { ...entry, file: new File([buffer], "battle.avro") };
}

function handleEntryFor(
  path: string,
  declaredSize: number,
  bytes: Uint8Array,
): LocalAvroFileEntry & { handle: FileSystemFileHandle } {
  const entry = createLocalAvroFileEntry(parseLocalAvroPath(path), {
    size: declaredSize,
    lastModified: 1,
  });
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], "battle.avro");
  return {
    ...entry,
    handle: {
      kind: "file",
      name: file.name,
      getFile: async () => file,
    } as unknown as FileSystemFileHandle,
  };
}

describe("LocalWorkerSession", () => {
  it("selects one latest table version when the query omits it", async () => {
    const bytes = battleFixtureBytes;
    const expectedCount = ocfDecoder.decodeAvroOcfToJson(bytes).length;
    const secondPath = relativePath.replace("1785499200_", "1785499201_");
    const decodeSpy = vi.spyOn(ocfDecoder, "decodeAvroOcfToJson");
    try {
      const session = new LocalWorkerSession();
      session.initialize({
        fingerprint: "implicit-version-fixture",
        entries: [entryFor(relativePath, bytes, "v1"), entryFor(secondPath, bytes, "v2")],
      });

      const result = await session.records(
        "request-implicit-version",
        { table: "battle", periodTag: "2026-07-08", limitRecords: 20_000 },
        () => undefined,
      );

      expect(result.count).toBe(expectedCount);
      expect(result.table_version).toBe("v2");
      expect(decodeSpy).toHaveBeenCalledTimes(1);
    } finally {
      decodeSpy.mockRestore();
    }
  });

  it("does not decode enemy relations from another period in overview", async () => {
    const battleBytes = battleFixtureBytes;
    const previousPeriodDeckPath = enemyDeckPath.replace("2026-07-08", "2026-06-26");
    const previousPeriodShipPath = enemyShipPath.replace("2026-07-08", "2026-06-26");
    const decodeSpy = vi.spyOn(ocfDecoder, "decodeAvroOcfToJson");
    try {
      const session = new LocalWorkerSession();
      session.initialize({
        fingerprint: "period-scoped-overview-fixture",
        entries: [
          entryFor(relativePath, battleBytes),
          entryFor(enemyDeckPath, enemyDeckFixtureBytes),
          entryFor(previousPeriodDeckPath, enemyDeckFixtureBytes),
          entryFor(enemyShipPath, enemyShipFixtureBytes),
          entryFor(previousPeriodShipPath, enemyShipFixtureBytes),
        ],
      });

      await session.overview(
        "request-period-scoped-overview",
        { periodTag: "2026-07-08", masterShips: [] },
        () => undefined,
      );

      expect(decodeSpy).toHaveBeenCalledTimes(3);
    } finally {
      decodeSpy.mockRestore();
    }
  });

  it("filters records by the requested embedded table version", async () => {
    const bytes = battleFixtureBytes;
    const secondPath = relativePath.replace("1785499200_", "1785499201_");
    const session = new LocalWorkerSession();
    session.initialize({
      fingerprint: "versioned-fixture",
      entries: [entryFor(relativePath, bytes, "v1"), entryFor(secondPath, bytes, "v2")],
    });

    const result = await session.records(
      "request-versioned",
      {
        table: "battle",
        periodTag: "2026-07-08",
        tableVersion: "v2",
        limitRecords: 10,
      },
      () => undefined,
    );

    expect(result.table_version).toBe("v2");
    expect(result.records.length).toBeGreaterThan(0);
    expect(session.listPeriods("battle")).toEqual([
      { periodTag: "2026-07-08", tableVersion: null },
    ]);
  });

  it("keeps table version unresolved when metadata is incomplete", async () => {
    const bytes = battleFixtureBytes;
    const secondPath = relativePath.replace("1785499200_", "1785499201_");
    const session = new LocalWorkerSession();
    session.initialize({
      fingerprint: "incomplete-version-fixture",
      entries: [entryFor(relativePath, bytes, "v1"), entryFor(secondPath, bytes)],
    });

    expect(session.listPeriods("battle")).toEqual([
      { periodTag: "2026-07-08", tableVersion: null },
    ]);
    await expect(
      session.records(
        "request-incomplete-version",
        { table: "battle", periodTag: "2026-07-08", limitRecords: 1 },
        () => undefined,
      ),
    ).resolves.toMatchObject({ table_version: null });
  });

  it("enforces the configured query record limit", async () => {
    const bytes = battleFixtureBytes;
    const session = new LocalWorkerSession();
    session.initialize({
      fingerprint: "limited-fixture",
      limits: { maxManifestBytes: bytes.byteLength, maxQueryRecords: 1 },
      entries: [entryFor(relativePath, bytes)],
    });

    await expect(
      session.records(
        "request-limited",
        { table: "battle", periodTag: "2026-07-08", limitRecords: 2 },
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "OUT_OF_MEMORY_GUARD" });
  });

  it("checks actual bytes read from persistent file handles", async () => {
    const bytes = battleFixtureBytes;
    const session = new LocalWorkerSession();
    session.initialize({
      fingerprint: "persistent-size-fixture",
      limits: { maxManifestBytes: 2, maxQueryRecords: 20_000 },
      entries: [handleEntryFor(relativePath, 1, bytes)],
    });

    await expect(
      session.records(
        "request-persistent-size",
        { table: "battle", periodTag: "2026-07-08", limitRecords: 1 },
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "OUT_OF_MEMORY_GUARD" });
  });

  it("decodes and filters a local AVRO table in worker memory", async () => {
    const bytes = battleFixtureBytes;
    const session = new LocalWorkerSession();
    session.initialize({
      fingerprint: "fixture",
      entries: [entryFor(relativePath, bytes)],
    });

    const progress: Array<{ phase: string; label?: string }> = [];
    const result = await session.records(
      "request-1",
      {
        table: "battle",
        periodTag: "2026-07-08",
        limitRecords: 10,
        filter: { index: 0 },
      },
      (phase, _completed, _total, label) =>
        progress.push({ phase, ...(label === undefined ? {} : { label }) }),
    );

    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.every((record) => record["index"] === 0)).toBe(true);
    expect(result.records[0]).toMatchObject({ env_uuid: expect.any(String) });
    expect(progress.map((item) => item.phase)).toContain("decode");
    expect(progress.map((item) => item.phase)).toContain("index");
    expect(progress.find((item) => item.phase === "decode")?.label).toBe("battle");
  });

  it("rejects an embedded schema that does not match the path table", async () => {
    const bytes = battleFixtureBytes;
    const cellsPath = relativePath.replace("/battle/", "/cells/");
    const session = new LocalWorkerSession();
    session.initialize({
      fingerprint: "fixture",
      entries: [entryFor(relativePath, bytes), entryFor(cellsPath, bytes)],
    });

    await expect(
      session.records(
        "request-2",
        { table: "cells", periodTag: "2026-07-08", limitRecords: 10 },
        () => undefined,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LocalBattleError>>({
        name: "LocalBattleError",
        code: "SCHEMA_PATH_MISMATCH",
        details: expect.objectContaining({
          table: "cells",
          periodTag: "2026-07-08",
          phase: "decode",
          relativePath: cellsPath,
        }),
      }),
    );
  });

  it("filters oversized all-period detail tables before applying the record guard", async () => {
    const bytes = battleFixtureBytes;
    const target = ocfDecoder.decodeAvroOcfToJson(bytes)[0];
    if (!target) throw new Error("fixture AVRO file has no records");
    const envUuid = String(target["env_uuid"]);
    const battleIndex = Number(target["index"]);
    const unrelatedRows = Array.from({ length: 20_000 }, (_, index) => ({
      env_uuid: `unrelated-${index}`,
      index,
    }));
    const decodeSpy = vi
      .spyOn(ocfDecoder, "decodeAvroOcfToJson")
      .mockImplementation((_bytes, options) => {
        const rows = [...unrelatedRows, target];
        const recordFilter = options?.recordFilter;
        return recordFilter ? rows.filter(recordFilter) : rows;
      });
    try {
      const session = new LocalWorkerSession();
      session.initialize({
        fingerprint: "oversized-all-period-detail",
        entries: [entryFor(relativePath, bytes)],
      });

      const result = await session.detail(
        "request-oversized-detail",
        { envUuid, battleIndex, periodTag: "all" },
        () => undefined,
      );

      expect(result.battle).toMatchObject({ env_uuid: envUuid, index: battleIndex });
      expect(decodeSpy).toHaveBeenCalled();
    } finally {
      decodeSpy.mockRestore();
    }
  });
});