import { describe, expect, it } from "vitest";
import { parseOcfHeader } from "../../../avro/ocf-header";
import { buildAvroOcfFixture } from "../../../avro/test-fixtures";
import {
  createLocalAvroFileEntry,
  LocalAvroPathError,
  parseLocalAvroPath,
} from "../manifest";

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

  it("rejects zero period and non-positive map paths", () => {
    expect(() =>
      parseLocalAvroPath(
        "0/transaction_data/1-1/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro",
      ),
    ).toThrow(LocalAvroPathError);
    expect(() =>
      parseLocalAvroPath(
        "2026-06-26/transaction_data/0-0/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro",
      ),
    ).toThrow(LocalAvroPathError);
  });

  it("matches the local fixture path and OCF header together", () => {
    const relativePath =
      "fusou/2026-02-13/master_data/mst_ships.avro";
    const parsed = parseLocalAvroPath(relativePath);
    const bytes = buildAvroOcfFixture("MstShip", [
      { id: 1, name: "fixture" },
    ]);
    const header = parseOcfHeader(bytes);

    expect(parsed.table).toBe("mst_ships");
    expect(header.codec).toBe("null");
    expect(header.schema.name).toBe("MstShip");
    expect(
      createLocalAvroFileEntry(parsed, {
        size: bytes.byteLength,
        lastModified: 1,
      }).size,
    ).toBe(bytes.byteLength);
  });
});