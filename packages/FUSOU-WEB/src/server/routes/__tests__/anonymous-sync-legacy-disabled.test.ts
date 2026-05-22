import { describe, expect, it } from "vitest";
import anonymousSyncApp from "../anonymous-sync";

describe("anonymous-sync legacy v1 endpoint", () => {
  it("returns 410 Gone with replacement metadata", async () => {
    const response = await anonymousSyncApp.request(
      "http://localhost/anonymous-sync",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ member_id_hash: "deadbeef" }),
      },
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("Deprecation")).toBe("true");

    const json = (await response.json()) as {
      error?: string;
      code?: string;
      replacement?: Record<string, string>;
    };

    expect(json.code).toBe("legacy_anonymous_sync_v1_disabled");
    expect(json.replacement?.register).toBe(
      "/api/auth/anonymous-sync/v2/register",
    );
    expect(json.replacement?.refresh).toBe(
      "/api/auth/anonymous-sync/v2/refresh",
    );
  });
});
