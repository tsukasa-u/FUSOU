import { describe, expect, it, vi } from "vitest";
import {
  queryLocalDirectoryPermission,
  requireLocalDirectoryPermission,
} from "../permissions";

function handle(permission: PermissionState) {
  return {
    kind: "directory",
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => "granted" as PermissionState),
  } as unknown as FileSystemDirectoryHandle;
}

describe("local directory permissions", () => {
  it("does not request permission unless explicitly asked", async () => {
    const value = handle("prompt");
    await expect(queryLocalDirectoryPermission(value)).resolves.toBe("prompt");
    await expect(requireLocalDirectoryPermission(value)).resolves.toBe("prompt");
    expect((value as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission).not.toHaveBeenCalled();
  });

  it("requests only from the explicit permission path", async () => {
    const value = handle("prompt");
    await expect(requireLocalDirectoryPermission(value, { request: true })).resolves.toBe("granted");
    expect((value as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission).toHaveBeenCalledOnce();
  });
});