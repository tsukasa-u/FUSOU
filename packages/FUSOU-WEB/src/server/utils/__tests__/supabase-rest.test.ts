import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolvePublicIdForUser,
  resolvePublicIdsForUser,
} from "../supabase-rest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const config = {
  url: "https://supabase.example.test",
  key: "service-role-key",
};

function mockRows(rows: unknown[]) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("Supabase REST public ID resolution", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("returns all Web mappings in server-provided order", async () => {
    const newestPublicId = "33333333-3333-4333-8333-333333333333";
    const olderPublicId = "22222222-2222-4222-8222-222222222222";
    mockRows([{ public_id: newestPublicId }, { public_id: olderPublicId }]);

    await expect(resolvePublicIdsForUser(config, "user/1")).resolves.toEqual([
      newestPublicId,
      olderPublicId,
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/web_user_member_map?user_id=eq.user%2F1&select=public_id,updated_at&order=updated_at.desc",
      ),
      expect.any(Object),
    );
  });

  it("falls back to the canonical mapping when no Web mapping exists", async () => {
    const canonicalPublicId = "11111111-1111-4111-8111-111111111111";
    mockRows([]);
    mockRows([{ public_id: canonicalPublicId }]);

    await expect(resolvePublicIdForUser(config, "user-1")).resolves.toBe(
      canonicalPublicId,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/user_member_map?");
  });
});
