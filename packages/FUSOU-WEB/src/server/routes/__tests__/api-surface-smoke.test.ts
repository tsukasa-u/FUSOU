import { describe, expect, it } from "vitest";
import userApp from "../user";
import memberLookupApp from "../member-lookup";

describe("API surface smoke", () => {
  it("GET /user/member-map should enforce auth", async () => {
    const req = new Request("https://example.com/member-map", {
      method: "GET",
    });

    const res = await userApp.fetch(req);
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(401);
    expect(body.error).toContain("Missing Authorization");
  });

  it("POST /member-lookup/check-hash should validate required body", async () => {
    const req = new Request("https://example.com/check-hash", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const res = await memberLookupApp.fetch(req);
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("MISSING_MEMBER_ID_HASH");
  });

  it("legacy ownership endpoint should be absent", async () => {
    const req = new Request("https://example.com/verify-ownership", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ member_id_hash: "0".repeat(64) }),
    });

    const res = await memberLookupApp.fetch(req);
    const bodyText = await res.text();

    expect(res.status).toBe(404);
    expect(bodyText).toContain("404 Not Found");
  });

  it("legacy member-map upsert endpoint should be absent", async () => {
    const req = new Request("https://example.com/member-map/upsert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ member_id_hash: "0".repeat(64) }),
    });

    const res = await userApp.fetch(req);
    const bodyText = await res.text();

    expect(res.status).toBe(404);
    expect(bodyText).toContain("404 Not Found");
  });
});
