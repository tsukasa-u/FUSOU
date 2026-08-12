import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as ocfDecoder from "@/features/avro/ocf-decoder";
import {
  createLocalAvroFileEntry,
  parseLocalAvroPath,
  type LocalAvroFileEntry,
} from "../../local-directory/manifest";
import { LocalBattleError } from "../protocol";
import { LocalWorkerSession } from "../session";

const databaseRoot = resolve(process.cwd(), "../FUSOU-DATABASE");
const relativePath =
  "fusou/2026-07-08/transaction_data/5-4/battle/1785499200_4c78c801-1d64-4e66-bcac-82025884b215.avro";

function entryFor(path: string, bytes: Uint8Array): LocalAvroFileEntry & { file: File } {
  const entry = createLocalAvroFileEntry(parseLocalAvroPath(path), {
    size: bytes.byteLength,
    lastModified: 1,
  });
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return { ...entry, file: new File([buffer], "battle.avro") };
}

describe("LocalWorkerSession", () => {
  it("decodes and filters a real APP AVRO table in worker memory", async () => {
    const bytes = new Uint8Array(readFileSync(resolve(databaseRoot, relativePath)));
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
      (phase, _completed, _total, label) => progress.push({ phase, label }),
    );

    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.every((record) => record.index === 0)).toBe(true);
    expect(result.records[0]).toMatchObject({ env_uuid: expect.any(String) });
    expect(progress.map((item) => item.phase)).toContain("decode");
    expect(progress.map((item) => item.phase)).toContain("index");
    expect(progress.find((item) => item.phase === "decode")?.label).toBe("battle");
  });

  it("rejects an embedded schema that does not match the path table", async () => {
    const battlePath = resolve(databaseRoot, relativePath);
    const bytes = new Uint8Array(readFileSync(battlePath));
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
    const bytes = new Uint8Array(readFileSync(resolve(databaseRoot, relativePath)));
    const target = ocfDecoder.decodeAvroOcfToJson(bytes)[0];
    const envUuid = String(target.env_uuid);
    const battleIndex = Number(target.index);
    const unrelatedRows = Array.from({ length: 20_000 }, (_, index) => ({
      env_uuid: `unrelated-${index}`,
      index,
    }));
    const decodeSpy = vi
      .spyOn(ocfDecoder, "decodeAvroOcfToJson")
      .mockReturnValue([...unrelatedRows, target]);
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