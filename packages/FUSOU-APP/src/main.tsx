/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";

// import Root from './pages/root.tsx'
import App from "./pages/app.tsx";
import Start from "./pages/start.tsx";
import NotFound from "./pages/not_found.tsx";
import Debug from "./pages/debug.tsx";
import Login from "./pages/login.tsx";
import Close from "./pages/close.tsx";
import Updater from "./pages/update.tsx";
import ViewerPage from "./pages/viewer.tsx";

import "./global.css";
import { AuthProvider } from "./utility/provider.tsx";
import { ErrorBoundary, onMount } from "solid-js";

import { fetch_font } from "./utility/google_font.ts";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { performSnapshotSync } from "./utility/sync";
import { getAuthToken } from "./utility/auth";
import { ErrorFallback } from "./utility/ErrorFallback.tsx";
import { collectSnapshot } from "./utility/snapshot";

onMount(async () => {
  invoke<string>("get_app_theme", {})
    .then((theme) => {
      if (theme == "") return;

      localStorage.setItem("fusou-app-theme", theme);
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

onMount(async () => {
  // Listen for tray menu request to trigger a sync from the renderer side.
  try {
    const unlisten = await listen('tray-sync-snapshot', async () => {
      try {
        // Use the module-local snapshot registry (no globals).
        const payload: any = await collectSnapshot(5000);

        if (!payload) {
          console.error('tray-sync-snapshot handler error - no snapshot payload available (no registered collectors)');
          return;
        }

        const result = await performSnapshotSync(payload, getAuthToken);
        if (!result.ok) {
          console.error('tray-sync-snapshot: upload failed', result.status, result.text);
        } else {
          console.info('tray-sync-snapshot: upload succeeded');
        }
      } catch (e) {
        console.error('tray-sync-snapshot handler error', e);
      }
    });

    // we don't unlisten for the lifetime of the app; if desired keep reference.
    void unlisten;
  } catch (e) {
    console.error('Failed to listen for tray-sync-snapshot', e);
  }
});

render(
  () => (
    <AuthProvider>
      <ErrorBoundary
        fallback={(error, reset) => (
          <ErrorFallback error={error} reset={reset} />
        )}
      >
        <Router>
          <Route path="/viewer/:token" component={ViewerPage} />
          <Route path="/viewer" component={ViewerPage} />
          <Route path="/app" component={App} />
          <Route path="/" component={Start} />
          <Route path="*" component={NotFound} />
          <Route path="/debug" component={Debug} />
          <Route path="/auth" component={Login} />
          <Route path="/close" component={Close} />
          <Route path="/update" component={Updater} />
        </Router>
      </ErrorBoundary>
    </AuthProvider>
  ),
  document.getElementById("root") as HTMLElement
);
// render(() => <App />, document.getElementById("root") as HTMLElement);
