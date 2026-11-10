/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";

// import Root from './pages/root.tsx'
import App from "./pages/app.tsx";
import Start from "./pages/start.tsx";
import NotFound from "./pages/not_found.tsx";
import Debug from "./pages/debug.tsx";
import Updater from "./pages/update.tsx";
import Policy from "./pages/policy.tsx";
import DesignSystem from "./pages/design-system.tsx";

import "./global.css";
import { createSignal, ErrorBoundary, onCleanup, onMount } from "solid-js";

import { fetch_font } from "./utility/google_font.ts";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorFallback } from "./utility/ErrorFallback.tsx";
import { CustomTitlebar } from "./components/ui/titlebar.tsx";
import { WindowResizeBorders } from "./components/ui/window_resize_borders.tsx";

render(
  () => {
    const [isMaximized, setIsMaximized] = createSignal(false);

    onMount(async () => {
      const appWindow = getCurrentWindow();
      const rootEl = document.getElementById("root");

      const updateMaximizedState = async () => {
        try {
          const max = await appWindow.isMaximized();
          setIsMaximized(max);
          if (rootEl) {
            if (max) {
              rootEl.classList.add("is-maximized");
            } else {
              rootEl.classList.remove("is-maximized");
            }
          }
        } catch (e) {
          console.warn("Error checking window maximized state:", e);
        }
      };

      await updateMaximizedState();

      try {
        const unlisten = await appWindow.onResized(async () => {
          await updateMaximizedState();
        });
        onCleanup(() => unlisten());
      } catch (e) {
        console.warn("Failed to listen window resize:", e);
      }

      const cachedTheme = localStorage.getItem("fusou-app-theme");
      if (cachedTheme) {
        document.documentElement.setAttribute("data-theme", cachedTheme);
      }

      invoke<string>("get_app_theme", {})
        .then((theme) => {
          if (theme == "") return;
          localStorage.setItem("fusou-app-theme", theme);
          document.documentElement.setAttribute("data-theme", theme);
        })
        .catch((error) => {
          console.error("Error fetching app theme:", error);
        });

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
    });

    return (
      <ErrorBoundary
        fallback={(error, reset) => (
          <ErrorFallback error={error} reset={reset} />
        )}
      >
        <Router
          root={(props) => (
            <>
              <WindowResizeBorders isMaximized={isMaximized()} />
              <CustomTitlebar isMaximized={isMaximized()} />
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
      </ErrorBoundary>
    );
  },
  document.getElementById("root") as HTMLElement,
);
// render(() => <App />, document.getElementById("root") as HTMLElement);
