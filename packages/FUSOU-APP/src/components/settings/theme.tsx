import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { AppTheme } from "../../utility/theme";
import {
  APP_THEME_STORAGE_KEY,
  applyAppTheme,
  getCurrentAppTheme,
  subscribeAppTheme,
  toggleAppTheme,
} from "../../utility/theme";

/**
 * Click-to-toggle Light / Dark theme button designed for `CustomTitlebar`.
 */
export function ThemeControllerComponent() {
  const [currentTheme, setCurrentTheme] =
    createSignal<AppTheme>(getCurrentAppTheme());

  onMount(() => {
    const saved =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(APP_THEME_STORAGE_KEY)
        : null;
    if (saved === "light" || saved === "dark") {
      applyAppTheme(saved);
    }
    setCurrentTheme(getCurrentAppTheme());
    onCleanup(subscribeAppTheme(setCurrentTheme));
  });

  const handleToggle = () => {
    setCurrentTheme(toggleAppTheme());
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      class="fusou-tool-btn"
      aria-label={
        currentTheme() === "dark"
          ? "Switch to Light theme"
          : "Switch to Dark theme"
      }
      aria-pressed={currentTheme() === "dark"}
      title={
        currentTheme() === "dark"
          ? "Theme: Dark (Click to switch to Light)"
          : "Theme: Light (Click to switch to Dark)"
      }
    >
      <Show
        when={currentTheme() === "dark"}
        fallback={
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        }
      >
        <svg
          class="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      </Show>
    </button>
  );
}
