import { describe, expect, it } from "vitest";
import {
  loadStoredLocalDirectoryHandle,
  saveLocalDirectoryHandle,
  supportsLocalDirectoryHandlePersistence,
} from "../handle-store";

describe("local directory handle persistence", () => {
  it("does not claim persistence when IndexedDB is unavailable", async () => {
    expect(supportsLocalDirectoryHandlePersistence(null)).toBe(false);
    await expect(loadStoredLocalDirectoryHandle(null)).resolves.toBeNull();
  });

  it("does not persist anything without an IndexedDB factory", async () => {
    const handle = { kind: "directory", name: "fusou" } as FileSystemDirectoryHandle;
    await expect(saveLocalDirectoryHandle(handle, null)).resolves.toBe(false);
  });
});