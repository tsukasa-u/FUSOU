import { describe, expect, it } from "vitest";
import userApp from "../user";

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

  it("legacy ownership endpoint should be absent", async () => {
    const req = new Request("https://example.com/verify-ownership", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const res = await userApp.fetch(req);
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
      body: JSON.stringify({}),
    });

    const res = await userApp.fetch(req);
    const bodyText = await res.text();

    expect(res.status).toBe(404);
    expect(bodyText).toContain("404 Not Found");
  });

});
