import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOcfHeader } from "../../../avro/ocf-header";
import {
  createLocalAvroFileEntry,
  LocalAvroPathError,
  parseLocalAvroPath,
} from "../manifest";

const databaseRoot = resolve(process.cwd(), "../FUSOU-DATABASE");

describe("APP local AVRO manifest paths", () => {
  it("parses a transaction path and keeps table version unresolved", () => {
    const parsed = parseLocalAvroPath(
      "fusou/2026-06-26/transaction_data/6-5/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro",
    );

    expect(parsed).toMatchObject({
      periodTag: "2026-06-26",
      storageKind: "transaction_data",
      table: "battle",
      mapAreaId: 6,
      mapInfoNo: 5,
      fileTimestamp: 1783429200,
    });

    const entry = createLocalAvroFileEntry(parsed, {
      size: 12787,
      lastModified: 1,
    });
    expect(entry.tableVersion).toBeNull();
    expect(entry.id).toContain("\0");
  });

  it("accepts the actual master filename contract", () => {
    const parsed = parseLocalAvroPath(
      "2026-02-13/master_data/mst_ships.avro",
    );
    expect(parsed).toMatchObject({
      periodTag: "2026-02-13",
      storageKind: "master_data",
      table: "mst_ships",
    });
  });

  it("rejects kcsapi and unknown AVRO paths", () => {
    expect(() =>
      parseLocalAvroPath("2026-06-26/kcsapi/1783051200S@api_req_map/start2"),
    ).toThrow(LocalAvroPathError);
    expect(() =>
      parseLocalAvroPath("2026-06-26/transaction_data/6-5/unknown/1_uuid.avro"),
    ).toThrow(LocalAvroPathError);
  });

  it("matches the real database path and OCF header together", () => {
    const relativePath =
      "fusou/2026-02-13/master_data/mst_ships.avro";
    const parsed = parseLocalAvroPath(relativePath);
    const filePath = resolve(databaseRoot, relativePath);
    const stat = statSync(filePath);
    const header = parseOcfHeader(
      new Uint8Array(readFileSync(filePath)),
    );

    expect(parsed.table).toBe("mst_ships");
    expect(header.codec).toBe("null");
    expect(header.schema.name).toBe("MstShip");
    expect(
      createLocalAvroFileEntry(parsed, {
        size: stat.size,
        lastModified: stat.mtimeMs,
      }).size,
    ).toBe(stat.size);
  });
});