import { describe, expect, it } from "vitest";
import { expectedSchemaNameForTable } from "../schema-registry";

describe("local AVRO schema registry", () => {
  it("keeps path aliases tied to the embedded record name", () => {
    expect(expectedSchemaNameForTable("battle")).toBe("Battle");
    expect(expectedSchemaNameForTable("mst_ships")).toBe("MstShip");
    expect(expectedSchemaNameForTable("mst_equip_exslot_ships")).toBe(
      "MstEquipExslotShip",
    );
  });

  it("does not infer a schema for an unknown table", () => {
    expect(expectedSchemaNameForTable("unknown_table")).toBeNull();
  });
});