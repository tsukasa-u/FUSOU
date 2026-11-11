import { afterEach, describe, expect, it } from "vitest";
import {
  APP_THEME_STORAGE_KEY,
  applyAppTheme,
  getCurrentAppTheme,
  getNextAppTheme,
  normalizeAppTheme,
  toggleAppTheme,
} from "./theme";

describe("theme utility", () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    delete (globalThis as { document?: unknown }).document;
  });

  it("normalizes and computes next toggle theme", () => {
    expect(normalizeAppTheme("dark")).toBe("dark");
    expect(normalizeAppTheme("light")).toBe("light");
    expect(normalizeAppTheme("unknown")).toBe("light");
    expect(normalizeAppTheme(undefined)).toBe("light");

    expect(getNextAppTheme("light")).toBe("dark");
    expect(getNextAppTheme("dark")).toBe("light");
  });

  it("persists and toggles theme against DOM attribute and localStorage", () => {
    const store = new Map<string, string>();
    const attrs = new Map<string, string>();

    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    (globalThis as { document?: unknown }).document = {
      documentElement: {
        getAttribute: (k: string) => attrs.get(k) ?? null,
        setAttribute: (k: string, v: string) => void attrs.set(k, v),
      },
    };

    expect(getCurrentAppTheme()).toBe("light");
    expect(applyAppTheme("dark")).toBe("dark");
    expect(store.get(APP_THEME_STORAGE_KEY)).toBe("dark");
    expect(attrs.get("data-theme")).toBe("dark");
    expect(getCurrentAppTheme()).toBe("dark");

    expect(toggleAppTheme()).toBe("light");
    expect(store.get(APP_THEME_STORAGE_KEY)).toBe("light");
    expect(attrs.get("data-theme")).toBe("light");
  });
});
