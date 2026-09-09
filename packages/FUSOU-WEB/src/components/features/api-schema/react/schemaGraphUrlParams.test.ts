import { describe, expect, it } from "vitest";
import {
  buildSearchString,
  findMajorForVersion,
  getEpochDate,
  getLatestEpochFeature,
  parseSelectionFromUrl,
  sortEpochFeatures,
  type SelectionMetadata,
} from "./schemaGraphUrlParams";

describe("schemaGraphUrlParams", () => {
  const mockMeta: SelectionMetadata = {
    allDbVersions: ["v0_4", "v0_5", "v0_6_0"],
    majorVersions: {
      v0: { versions: ["v0_4", "v0_5", "v0_6_0"], latest: "v0_6_0" },
    },
    defaultMajor: "v0",
    defaultDbVersion: "v0_6_0",
    endpointGroups: {
      api_port: { endpoints: [{ name: "port" }] },
      api_req_sortie: { endpoints: [{ name: "battle" }, { name: "battleresult" }] },
    },
    allFeatures: ["epoch_20250627", "genesis"],
    activeFeatures: ["genesis"],
    defaultEndpointVersion: "epoch_20250627",
  };

  describe("epoch version helpers", () => {
    it("getEpochDate extracts date integer or 0 for genesis", () => {
      expect(getEpochDate("genesis")).toBe(0);
      expect(getEpochDate("epoch_20250627")).toBe(20250627);
      expect(getEpochDate("epoch_20250815")).toBe(20250815);
      expect(getEpochDate("unknown_feature")).toBe(-1);
    });

    it("sortEpochFeatures sorts features chronologically (genesis -> older epochs -> newer epochs)", () => {
      const features = ["epoch_20250627", "genesis", "epoch_20250815", "epoch_20240101"];
      expect(sortEpochFeatures(features)).toEqual([
        "genesis",
        "epoch_20240101",
        "epoch_20250627",
        "epoch_20250815",
      ]);
    });

    it("getLatestEpochFeature selects feature with latest date", () => {
      expect(getLatestEpochFeature(["epoch_20250627", "genesis"])).toBe("epoch_20250627");
      expect(getLatestEpochFeature(["genesis", "epoch_20240101", "epoch_20250815"])).toBe(
        "epoch_20250815",
      );
      expect(getLatestEpochFeature(["genesis"])).toBe("genesis");
      expect(getLatestEpochFeature([])).toBe("");
    });
  });

  it("findMajorForVersion finds corresponding major key", () => {
    expect(findMajorForVersion("v0_5", mockMeta.majorVersions)).toBe("v0");
    expect(findMajorForVersion("v9_9", mockMeta.majorVersions)).toBeNull();
  });

  it("parseSelectionFromUrl falls back to latest version defaults with empty query", () => {
    const sel = parseSelectionFromUrl("", mockMeta);
    expect(sel.mode).toBe("database");
    expect(sel.dbVersion).toBe("v0_6_0");
    expect(sel.selectedMajor).toBe("v0");
    expect(sel.selectedGroup).toBe("");
    expect(sel.selectedEndpoint).toBe("");
    expect(sel.endpointVersion).toBe("epoch_20250627");
  });

  it("parseSelectionFromUrl defaults to latest epoch feature when in endpoints mode without version param", () => {
    const sel = parseSelectionFromUrl("?mode=endpoints&group=api_port&endpoint=port", mockMeta);
    expect(sel.mode).toBe("endpoints");
    expect(sel.endpointVersion).toBe("epoch_20250627");
  });

  it("parseSelectionFromUrl parses database mode with specific version", () => {
    const sel = parseSelectionFromUrl("?mode=database&version=v0_5", mockMeta);
    expect(sel.mode).toBe("database");
    expect(sel.dbVersion).toBe("v0_5");
    expect(sel.selectedMajor).toBe("v0");
  });

  it("parseSelectionFromUrl parses endpoints mode with explicit version", () => {
    const sel = parseSelectionFromUrl(
      "?mode=endpoints&group=api_req_sortie&endpoint=battle&version=genesis",
      mockMeta,
    );
    expect(sel.mode).toBe("endpoints");
    expect(sel.selectedGroup).toBe("api_req_sortie");
    expect(sel.selectedEndpoint).toBe("battle");
    expect(sel.endpointVersion).toBe("genesis");
  });

  it("parseSelectionFromUrl falls back to first endpoint if endpoint is invalid", () => {
    const sel = parseSelectionFromUrl(
      "?mode=endpoints&group=api_req_sortie&endpoint=invalid_endpoint",
      mockMeta,
    );
    expect(sel.selectedGroup).toBe("api_req_sortie");
    expect(sel.selectedEndpoint).toBe("battle");
  });

  it("parseSelectionFromUrl infers endpoints mode when group is present", () => {
    const sel = parseSelectionFromUrl("?group=api_port&endpoint=port", mockMeta);
    expect(sel.mode).toBe("endpoints");
    expect(sel.selectedGroup).toBe("api_port");
    expect(sel.selectedEndpoint).toBe("port");
    expect(sel.endpointVersion).toBe("epoch_20250627");
  });

  it("buildSearchString correctly serializes database mode and strips endpoint keys", () => {
    const search = buildSearchString(
      {
        mode: "database",
        selectedMajor: "v0",
        dbVersion: "v0_5",
        endpointVersion: "epoch_20250627",
        selectedGroup: "api_port",
        selectedEndpoint: "port",
      },
      "?group=api_port&endpoint=port",
    );
    const params = new URLSearchParams(search);
    expect(params.get("mode")).toBe("database");
    expect(params.get("version")).toBe("v0_5");
    expect(params.get("group")).toBeNull();
    expect(params.get("endpoint")).toBeNull();
  });

  it("buildSearchString correctly serializes endpoints mode", () => {
    const search = buildSearchString(
      {
        mode: "endpoints",
        selectedMajor: "v0",
        dbVersion: "v0_6_0",
        endpointVersion: "genesis",
        selectedGroup: "api_req_sortie",
        selectedEndpoint: "battle",
      },
      "",
    );
    const params = new URLSearchParams(search);
    expect(params.get("mode")).toBe("endpoints");
    expect(params.get("group")).toBe("api_req_sortie");
    expect(params.get("endpoint")).toBe("battle");
    expect(params.get("version")).toBe("genesis");
  });
});
