export const APP_THEME_STORAGE_KEY = "fusou-app-theme";
export type AppTheme = "light" | "dark";

/**
 * Normalizes any theme string to a supported DaisyUI app theme.
 */
export function normalizeAppTheme(value: string | null | undefined): AppTheme {
  return value === "dark" ? "dark" : "light";
}

/**
 * Returns the opposite theme for single-click toggling.
 */
export function getNextAppTheme(current: AppTheme): AppTheme {
  return current === "dark" ? "light" : "dark";
}

/**
 * Reads the currently active theme from `data-theme`, falling back to localStorage.
 */
export function getCurrentAppTheme(): AppTheme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") {
      return attr;
    }
  }
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  }
  return "light";
}

/**
 * Persists and applies the given theme to `document.documentElement`.
 */
export function applyAppTheme(theme: AppTheme): AppTheme {
  const normalized = normalizeAppTheme(theme);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(APP_THEME_STORAGE_KEY, normalized);
  }
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", normalized);
  }
  return normalized;
}

/**
 * Toggles between `"light"` and `"dark"` themes and persists the result.
 */
export function toggleAppTheme(): AppTheme {
  return applyAppTheme(getNextAppTheme(getCurrentAppTheme()));
}

/**
 * Watches `data-theme` attribute changes and cross-tab storage updates.
 */
export function subscribeAppTheme(
  onChange: (theme: AppTheme) => void,
): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const observer = new MutationObserver(() => {
    onChange(getCurrentAppTheme());
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  const handleStorage = (e: StorageEvent) => {
    if (e.key === APP_THEME_STORAGE_KEY && e.newValue) {
      const normalized = normalizeAppTheme(e.newValue);
      document.documentElement.setAttribute("data-theme", normalized);
      onChange(normalized);
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    observer.disconnect();
    window.removeEventListener("storage", handleStorage);
  };
}
