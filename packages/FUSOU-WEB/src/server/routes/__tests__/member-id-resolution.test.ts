import { describe, expect, it } from "vitest";
import { resolvePublicIdForUser } from "../../utils";

function createSupabaseAdminMock(options: {
  canonicalPublicId: string | null;
  error?: unknown;
}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: options.canonicalPublicId
              ? { public_id: options.canonicalPublicId }
              : null,
            error: options.error ?? null,
          }),
        }),
      }),
    }),
  };
}

describe("resolvePublicIdForUser", () => {
  it("returns the canonical owner mapping", async () => {
    const canonicalPublicId = "11111111-1111-4111-8111-111111111111";

    const resolved = await resolvePublicIdForUser({
      supabaseAdmin: createSupabaseAdminMock({
        canonicalPublicId,
      }),
      userId: "user-1",
    });

    expect(resolved).toEqual({
      publicId: canonicalPublicId,
      source: "canonical_owner",
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
});
