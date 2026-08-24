import { describe, expect, it } from "vitest";
import {
  resolvePublicIdForUser,
  resolvePublicIdsForUser,
} from "../../utils";

function createSupabaseAdminMock(options: {
  webPublicId?: string | null;
  webPublicIds?: string[];
  canonicalPublicId: string | null;
  error?: unknown;
}) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data:
              table === "web_user_member_map"
                ? (options.webPublicIds ??
                    (options.webPublicId ? [options.webPublicId] : []))
                    .map((public_id) => ({ public_id }))
                : options.canonicalPublicId
                  ? [{ public_id: options.canonicalPublicId }]
                  : [],
            error: options.error ?? null,
          }),
        }),
      }),
    }),
  };
}

describe("resolvePublicIdForUser", () => {
  it("returns the canonical user-to-dataset mapping", async () => {
    const canonicalPublicId = "11111111-1111-4111-8111-111111111111";

    const resolved = await resolvePublicIdForUser({
      supabaseAdmin: createSupabaseAdminMock({
        canonicalPublicId,
      }),
      userId: "user-1",
    });

    expect(resolved).toEqual({
      publicId: canonicalPublicId,
      source: "canonical_mapping",
    });
  });

  it("rejects an invalid canonical public_id", async () => {
    const canonicalPublicId = "not-a-uuid";

    const resolved = await resolvePublicIdForUser({
      supabaseAdmin: createSupabaseAdminMock({
        canonicalPublicId,
      }),
      userId: "user-2",
    });

    expect(resolved).toEqual({
      publicId: null,
      source: null,
    });
  });

  it("returns null when no canonical mapping exists", async () => {
    const resolved = await resolvePublicIdForUser({
      supabaseAdmin: createSupabaseAdminMock({ canonicalPublicId: null }),
      userId: "user-4",
    });

    expect(resolved).toEqual({
      publicId: null,
      source: null,
    });
  });
  it("returns the newest Web mapping for single-UUID callers", async () => {
    const newestPublicId = "33333333-3333-4333-8333-333333333333";
    const olderPublicId = "22222222-2222-4222-8222-222222222222";

    const resolved = await resolvePublicIdForUser({
      supabaseAdmin: createSupabaseAdminMock({
        webPublicIds: [newestPublicId, olderPublicId],
        canonicalPublicId: null,
      }),
      userId: "user-1",
    });

    expect(resolved).toEqual({
      publicId: newestPublicId,
      source: "web_mapping",
    });
  });

  it("returns all Web mappings for multi-UUID callers", async () => {
    const newestPublicId = "33333333-3333-4333-8333-333333333333";
    const olderPublicId = "22222222-2222-4222-8222-222222222222";

    const resolved = await resolvePublicIdsForUser({
      supabaseAdmin: createSupabaseAdminMock({
        webPublicIds: [newestPublicId, olderPublicId],
        canonicalPublicId: null,
      }),
      userId: "user-1",
    });

    expect(resolved).toEqual({
      publicIds: [newestPublicId, olderPublicId],
      source: "web_mapping",
    });
  });
});
