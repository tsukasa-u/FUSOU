import { describe, expect, it } from "vitest";
import { resolveLinkedMemberIdHashForUser } from "../../utils";

function createSupabaseAdminMock(options: {
  canonicalMemberIdHash: string | null;
  error?: unknown;
}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: options.canonicalMemberIdHash
              ? { member_id_hash: options.canonicalMemberIdHash }
              : null,
            error: options.error ?? null,
          }),
        }),
      }),
    }),
  };
}

describe("resolveLinkedMemberIdHashForUser", () => {
  it("returns canonical owner mapping when JWT metadata is absent", async () => {
    const canonicalHash = "a".repeat(64);

    const resolved = await resolveLinkedMemberIdHashForUser({
      supabaseAdmin: createSupabaseAdminMock({
        canonicalMemberIdHash: canonicalHash,
      }),
      userId: "user-1",
      jwtPayload: {},
    });

    expect(resolved).toEqual({
      memberIdHash: canonicalHash,
      source: "canonical_owner",
    });
  });

  it("uses verified JWT metadata when it matches canonical mapping", async () => {
    const canonicalHash = "b".repeat(64);

    const resolved = await resolveLinkedMemberIdHashForUser({
      supabaseAdmin: createSupabaseAdminMock({
        canonicalMemberIdHash: canonicalHash,
      }),
      userId: "user-2",
      jwtPayload: { member_id_hash: canonicalHash },
    });

    expect(resolved).toEqual({
      memberIdHash: canonicalHash,
      source: "jwt_metadata",
    });
  });

  it("falls back to canonical mapping when JWT metadata mismatches", async () => {
    const canonicalHash = "c".repeat(64);
    const mismatchedHash = "d".repeat(64);

    const resolved = await resolveLinkedMemberIdHashForUser({
      supabaseAdmin: createSupabaseAdminMock({
        canonicalMemberIdHash: canonicalHash,
      }),
      userId: "user-3",
      jwtPayload: { member_id_hash: mismatchedHash },
    });

    expect(resolved).toEqual({
      memberIdHash: canonicalHash,
      source: "canonical_owner",
    });
  });

  it("rejects unverified JWT metadata when canonical mapping is missing", async () => {
    const jwtHash = "e".repeat(64);

    const resolved = await resolveLinkedMemberIdHashForUser({
      supabaseAdmin: createSupabaseAdminMock({ canonicalMemberIdHash: null }),
      userId: "user-4",
      jwtPayload: { member_id_hash: jwtHash },
    });

    expect(resolved).toEqual({
      memberIdHash: null,
      source: null,
    });
  });
});
