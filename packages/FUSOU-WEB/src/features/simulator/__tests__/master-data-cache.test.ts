import { describe, expect, it } from "vitest";
import {
  supportsMasterDataCache,
  loadMasterDataCache,
  saveMasterDataCache,
  loadAllCachedMasterData,
  clearMasterDataCache,
} from "../master-data-cache";

describe("master data cache persistence", () => {
  it("does not claim persistence when IndexedDB is unavailable", () => {
    expect(supportsMasterDataCache(null)).toBe(false);
  });

  it("handles null factory gracefully on read", async () => {
    await expect(loadMasterDataCache("test-key", null)).resolves.toBeNull();
  });

  it("handles null factory gracefully on loadAll", async () => {
    const all = await loadAllCachedMasterData(null);
    expect(all.size).toBe(0);
  });

  it("handles null factory gracefully on write", async () => {
    await expect(saveMasterDataCache("test-key", { value: 123 }, undefined, null)).resolves.toBe(false);
  });

  it("handles null factory gracefully on clear", async () => {
    await expect(clearMasterDataCache(null)).resolves.toBe(false);
  });
});
