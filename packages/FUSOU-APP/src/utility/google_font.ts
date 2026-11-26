export const APP_FONT_STORAGE_KEY = "fusou-app-font-family";

export type AppliedFontSource = "default" | "system" | "google" | "fallback";

export interface ApplyAppFontOptions {
  /** Known locally installed OS font family names (compared case-insensitively). */
  knownSystemFonts?: ReadonlySet<string>;
  /** Sync the selected font family to localStorage so sibling webviews (e.g. combined chrome) update too. */
  persistStorage?: boolean;
}

export interface ApplyAppFontResult {
  source: AppliedFontSource;
  cssFontFamily: string;
}

const ACTIVE_GOOGLE_FONT_STYLE_ATTR = "data-fusou-google-font-active";
const PREVIEW_GOOGLE_FONT_STYLE_PREFIX = "fusou-google-font-preview-";

const googleFontCssCache = new Map<string, string | null>();
const googleFontInflight = new Map<string, Promise<string | null>>();

/**
 * Formats a font family name into a safe CSS `font-family` declaration
 * with sensible system fallbacks.
 */
export function formatCssFontFamily(fontFamily: string): string {
  const trimmed = fontFamily.trim();
  if (!trimmed) return "";

  const escaped = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

function normalizeKey(fontFamily: string): string {
  return fontFamily.trim().toLowerCase();
}

function hasKnownSystemFont(
  fontFamily: string,
  knownSystemFonts?: ReadonlySet<string>,
): boolean {
  if (!knownSystemFonts || knownSystemFonts.size === 0) return false;
  const target = normalizeKey(fontFamily);
  if (knownSystemFonts.has(target)) return true;
  for (const entry of knownSystemFonts) {
    if (entry.trim().toLowerCase() === target) {
      return true;
    }
  }
  return false;
}

function buildGoogleFontCssUrls(fontFamily: string): string[] {
  const encoded = encodeURIComponent(fontFamily.trim()).replace(/%20/g, "+");
  return [
    `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;500;600;700&display=swap`,
    `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;700&display=swap`,
    `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`,
  ];
}

/**
 * Fetches Google Fonts CSS2 stylesheet text for the given family name.
 * Returns `null` when the family does not exist on Google Fonts or the request fails.
 */
export async function fetchGoogleFontCss(
  fontFamily: string,
): Promise<string | null> {
  const trimmed = fontFamily.trim();
  if (!trimmed) return null;

  const cacheKey = normalizeKey(trimmed);
  if (googleFontCssCache.has(cacheKey)) {
    return googleFontCssCache.get(cacheKey) ?? null;
  }

  const existing = googleFontInflight.get(cacheKey);
  if (existing) return existing;

  const task = (async () => {
    for (const url of buildGoogleFontCssUrls(trimmed)) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const css = await response.text();
        if (css.includes("@font-face")) {
          googleFontCssCache.set(cacheKey, css);
          return css;
        }
      } catch {
        // Offline or blocked; try next URL or fall back to local system font
      }
    }
    googleFontCssCache.set(cacheKey, null);
    return null;
  })().finally(() => {
    googleFontInflight.delete(cacheKey);
  });

  googleFontInflight.set(cacheKey, task);
  return task;
}

function escapeAttrSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function upsertStyleElement(attrName: string, attrValue: string, css: string) {
  if (typeof document === "undefined") return;
  const head = document.head ?? document.documentElement;
  if (!head) return;

  let styleEl = document.querySelector<HTMLStyleElement>(
    `style[${attrName}="${escapeAttrSelectorValue(attrValue)}"]`,
  );
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.setAttribute(attrName, attrValue);
    head.appendChild(styleEl);
  }
  if (styleEl.textContent !== css) {
    styleEl.textContent = css;
  }
}

function removeActiveGoogleFontStyle() {
  if (typeof document === "undefined") return;
  const existing = document.querySelector<HTMLStyleElement>(
    `style[${ACTIVE_GOOGLE_FONT_STYLE_ATTR}]`,
  );
  if (existing) {
    existing.remove();
  }
}

/**
 * Loads a Google Font stylesheet into the document for live preview in Settings.
 * Returns `true` if Google Fonts returned a valid stylesheet, `false` otherwise.
 */
export async function loadGoogleFontForPreview(
  fontFamily: string,
): Promise<boolean> {
  const trimmed = fontFamily.trim();
  if (!trimmed) return false;

  const css = await fetchGoogleFontCss(trimmed);
  if (!css) return false;

  upsertStyleElement(
    "data-fusou-google-font-preview",
    `${PREVIEW_GOOGLE_FONT_STYLE_PREFIX}${normalizeKey(trimmed)}`,
    css,
  );
  return true;
}

function applyCssFontVariables(cssFontFamily: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root) {
    if (cssFontFamily) {
      root.style.setProperty("--font-sans", cssFontFamily);
      root.style.setProperty("--default-font-family", cssFontFamily);
      root.style.fontFamily = cssFontFamily;
    } else {
      root.style.removeProperty("--font-sans");
      root.style.removeProperty("--default-font-family");
      root.style.fontFamily = "";
    }
  }
  if (document.body) {
    document.body.style.fontFamily = cssFontFamily;
  }
}

/**
 * Applies either a system-installed font or a Google Font globally across `:root`,
 * Tailwind v4 `--font-sans` / `--default-font-family`, `html`, and `body`.
 *
 * - Empty value resets to the platform default UI font.
 * - Immediately applies the CSS variables & `fontFamily` so locally installed OS fonts
 *   take effect with zero network latency and work offline across modals, dialogs,
 *   form controls, and titlebar webviews.
 * - If not confirmed as a locally installed OS font, attempts to load from Google Fonts
 *   CSS2 (`unicode-range` & multi-weight aware) and silently falls back to the local font
 *   if unavailable.
 */
export async function applyAppFont(
  fontFamily: string,
  options?: ApplyAppFontOptions,
): Promise<ApplyAppFontResult> {
  const trimmed = fontFamily.trim();

  if (options?.persistStorage && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(APP_FONT_STORAGE_KEY, trimmed);
    } catch {
      // Ignore storage quota or sandbox restrictions
    }
  }

  if (!trimmed) {
    removeActiveGoogleFontStyle();
    applyCssFontVariables("");
    return { source: "default", cssFontFamily: "" };
  }

  const cssFontFamily = formatCssFontFamily(trimmed);
  applyCssFontVariables(cssFontFamily);

  if (hasKnownSystemFont(trimmed, options?.knownSystemFonts)) {
    removeActiveGoogleFontStyle();
    return { source: "system", cssFontFamily };
  }

  const css = await fetchGoogleFontCss(trimmed);
  if (css) {
    upsertStyleElement(ACTIVE_GOOGLE_FONT_STYLE_ATTR, "true", css);
    return { source: "google", cssFontFamily };
  }

  removeActiveGoogleFontStyle();
  return { source: "fallback", cssFontFamily };
}

/**
 * Backward-compatible helper that loads a Google Font stylesheet if available.
 */
export const fetch_font = async (font_family: string): Promise<boolean> => {
  const css = await fetchGoogleFontCss(font_family);
  if (!css) {
    throw new Error("failed to fetch font");
  }
  upsertStyleElement(ACTIVE_GOOGLE_FONT_STYLE_ATTR, "true", css);
  return true;
};

/** Clears internal caches (intended for tests). */
export function __resetFontLoaderCacheForTests(): void {
  googleFontCssCache.clear();
  googleFontInflight.clear();
}
