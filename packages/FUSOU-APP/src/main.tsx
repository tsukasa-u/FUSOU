/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";

import App from "./pages/app.tsx";
import Start from "./pages/start.tsx";
import NotFound from "./pages/not_found.tsx";
import Debug from "./pages/debug.tsx";
import Updater from "./pages/update.tsx";
import Policy from "./pages/policy.tsx";
import DesignSystem from "./pages/design-system.tsx";
import ChromePage from "./pages/chrome.tsx";

import "./global.css";
import {
  createEffect,
  createSignal,
  ErrorBoundary,
  onCleanup,
  onMount,
  Show,
} from "solid-js";

import { fetch_font } from "./utility/google_font.ts";
import {
  APP_THEME_STORAGE_KEY,
  applyAppTheme,
  normalizeAppTheme,
} from "./utility/theme.ts";
import {
  loadWindowLayoutState,
  subscribeWindowLayoutEvents,
  useWindowLayout,
} from "./utility/window_layout.ts";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorFallback } from "./utility/ErrorFallback.tsx";
import { CustomTitlebar } from "./components/ui/titlebar.tsx";
import { WindowResizeBorders } from "./components/ui/window_resize_borders.tsx";
import { SplitHandle } from "./components/ui/split_handle.tsx";

const isChromeSurface =
  new URLSearchParams(window.location.search).get("surface") === "chrome" ||
  window.location.pathname === "/chrome";

render(
  () => {
    const [isMaximized, setIsMaximized] = createSignal(false);
    const windowLayout = useWindowLayout();

    const isCombinedPanel = () =>
      !isChromeSurface && windowLayout.effective_mode === "combined";

    const showStandaloneTitlebar = () =>
      !isChromeSurface &&
      !isCombinedPanel() &&
      windowLayout.platform_capabilities.supports_custom_titlebar;

    createEffect(() => {
      const rootEl = document.getElementById("root");
      if (!rootEl) return;
      rootEl.classList.toggle("is-chrome-surface", isChromeSurface);
      rootEl.classList.toggle("is-docked-panel", isCombinedPanel());
      rootEl.classList.toggle(
        "dock-game-visible",
        isCombinedPanel() && windowLayout.game_visible,
      );
      rootEl.dataset.dockPosition = windowLayout.effective_dock_position;
    });

    onMount(async () => {
      const appWindow = getCurrentWindow();
      const rootEl = document.getElementById("root");

      void loadWindowLayoutState();
      const unlistenLayout = await subscribeWindowLayoutEvents();
      onCleanup(() => unlistenLayout());

      const updateMaximizedState = async () => {
        try {
          const max = await appWindow.isMaximized();
          setIsMaximized(max);
          if (rootEl) {
            rootEl.classList.toggle("is-maximized", max);
          }
        } catch (e) {
          console.warn("Error checking window maximized state:", e);
        }
      };

      await updateMaximizedState();

      let resizeTimer: number | null = null;
      try {
        const unlisten = await appWindow.onResized(() => {
          if (resizeTimer !== null) {
            window.clearTimeout(resizeTimer);
          }
          resizeTimer = window.setTimeout(() => {
            resizeTimer = null;
            void updateMaximizedState();
          }, 80);
        });
        onCleanup(() => {
          if (resizeTimer !== null) {
            window.clearTimeout(resizeTimer);
          }
          unlisten();
        });
      } catch (e) {
        console.warn("Failed to listen window resize:", e);
      }

      const cachedTheme = localStorage.getItem(APP_THEME_STORAGE_KEY);
      if (cachedTheme === "light" || cachedTheme === "dark") {
        applyAppTheme(cachedTheme);
      }

      // Sync theme changes across chrome and main webviews
      const onStorage = (event: StorageEvent) => {
        if (
          event.key === APP_THEME_STORAGE_KEY &&
          (event.newValue === "light" || event.newValue === "dark")
        ) {
          applyAppTheme(event.newValue);
        }
      };
      window.addEventListener("storage", onStorage);
      onCleanup(() => window.removeEventListener("storage", onStorage));

      invoke<string>("get_app_theme", {})
        .then((theme) => {
          if (theme == "" || cachedTheme) return;
          applyAppTheme(normalizeAppTheme(theme));
        })
        .catch((error) => {
          console.error("Error fetching app theme:", error);
        });

      if (!isChromeSurface) {
        invoke<string>("get_app_font", {})
          .then((font_family) => {
            if (font_family == "") return;
            fetch_font(font_family).then((font_css) => {
              if (font_css) {
                document.body.style.fontFamily = font_family;
              }
            });
          })
          .catch((error) => {
            console.error("Error fetching app font:", error);
          });
      }
    });

    return (
      <ErrorBoundary
        fallback={(error, reset) => (
          <ErrorFallback error={error} reset={reset} />
        )}
      >
        <Show
          when={!isChromeSurface}
          fallback={<ChromePage isMaximized={isMaximized()} />}
        >
          <Router
            root={(props) => (
              <>
                <Show when={windowLayout.platform_capabilities.supports_custom_titlebar}>
                  <WindowResizeBorders
                    isMaximized={isMaximized()}
                    edges={
                      isCombinedPanel() ? windowLayout.panel_edges : undefined
                    }
                  />
                </Show>
                <Show when={showStandaloneTitlebar()}>
                  <CustomTitlebar isMaximized={isMaximized()} />
                </Show>
                <Show when={isCombinedPanel() && windowLayout.game_visible}>
                  <SplitHandle
                    effectiveDockPosition={windowLayout.effective_dock_position}
                    isDragging={windowLayout.is_dragging_splitter}
                  />
                </Show>
                <div class="window-content-container">{props.children}</div>
              </>
            )}
          >
            <Route path="/app" component={App} />
            <Route path="/" component={Start} />
            <Route path="*" component={NotFound} />
            <Route path="/debug" component={Debug} />
            <Route path="/update" component={Updater} />
            <Route path="/policy" component={Policy} />
            <Route path="/design-system" component={DesignSystem} />
          </Router>
        </Show>
      </ErrorBoundary>
    );
  },
  document.getElementById("root") as HTMLElement,
);
