import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFontLoaderCacheForTests,
  applyAppFont,
  formatCssFontFamily,
} from "./google_font";

describe("google_font utility", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __resetFontLoaderCacheForTests();
    if (typeof document !== "undefined" && document.body) {
      document.body.style.fontFamily = "";
      document
        .querySelectorAll("style[data-fusou-google-font-active]")
        .forEach((el) => el.remove());
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("formats CSS font family safely with quotes and fallbacks", () => {
    expect(formatCssFontFamily("")).toBe("");
    expect(formatCssFontFamily("   ")).toBe("");
    expect(formatCssFontFamily("Yu Gothic UI")).toBe(
      '"Yu Gothic UI", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    );
    expect(formatCssFontFamily('Weird "Quoted" Font')).toContain(
      '"Weird \\"Quoted\\" Font"',
    );
  });

  it("resets to system default when font family is empty", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await applyAppFont("   ");
    expect(result).toEqual({ source: "default", cssFontFamily: "" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips Google Fonts network fetch for known installed system fonts", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await applyAppFont("Meiryo", {
      knownSystemFonts: new Set(["meiryo", "yu gothic ui"]),
    });

    expect(result.source).toBe("system");
    expect(result.cssFontFamily).toContain('"Meiryo"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back through multi-weight, 400;700, and single-weight CSS2 URLs", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "" })
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          "@font-face { font-family: 'DotGothic16'; src: url(https://example.test/font.woff2); }",
      });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await applyAppFont("DotGothic16");
    expect(result.source).toBe("google");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][0]).toContain("DotGothic16:wght@400;500;600;700");
    expect(mockFetch.mock.calls[1][0]).toContain("DotGothic16:wght@400;700");
    expect(mockFetch.mock.calls[2][0]).toContain("family=DotGothic16&display=swap");
  });

  it("loads 2-weight Japanese Google Fonts using wght@400;700 before single-weight fallback", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          "@font-face { font-family: 'BIZ UDPGothic'; font-weight: 700; src: url(https://example.test/bold.woff2); }",
      });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await applyAppFont("BIZ UDPGothic");
    expect(result.source).toBe("google");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain("BIZ+UDPGothic:wght@400;700");
  });

  it("still applies local font CSS cleanly when Google Fonts returns 400", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "",
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await applyAppFont("My Local Font");
    expect(result.source).toBe("fallback");
    expect(result.cssFontFamily).toContain('"My Local Font"');
  });
});
