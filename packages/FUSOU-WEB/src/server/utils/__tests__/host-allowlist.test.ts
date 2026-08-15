import { describe, expect, it } from "vitest";
import { isAllowedHost, parseAllowedHosts } from "../host-allowlist";

describe("host allowlist", () => {
  it("keeps exact hosts exact and only enables explicit wildcards", () => {
    const allowed = new Set(
      parseAllowedHosts("https://example.com,*.preview.example.com"),
    );

    expect(isAllowedHost("example.com", allowed)).toBe(true);
    expect(isAllowedHost("sub.example.com", allowed)).toBe(false);
    expect(isAllowedHost("app.preview.example.com", allowed)).toBe(true);
    expect(isAllowedHost("preview.example.com", allowed)).toBe(false);
  });

  it("does not turn a request host into an allowed host", () => {
    const allowed = new Set(parseAllowedHosts("https://example.com"));

    expect(isAllowedHost("attacker.example", allowed)).toBe(false);
    expect(isAllowedHost("example.com.evil.test", allowed)).toBe(false);
  });
});
