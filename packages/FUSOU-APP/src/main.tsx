/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";

// import Root from './pages/root.tsx'
import App from "./pages/app.tsx";
import Start from "./pages/start.tsx";
import NotFound from "./pages/not_found.tsx";
import Debug from "./pages/debug.tsx";
import Updater from "./pages/update.tsx";

import "./global.css";
import { ErrorBoundary, onMount } from "solid-js";

import { fetch_font } from "./utility/google_font.ts";
import { invoke } from "@tauri-apps/api/core";
import { ErrorFallback } from "./utility/ErrorFallback.tsx";

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

render(
  () => (
    <ErrorBoundary
      fallback={(error, reset) => <ErrorFallback error={error} reset={reset} />}
    >
      <Router>
        <Route path="/app" component={App} />
        <Route path="/" component={Start} />
        <Route path="*" component={NotFound} />
        <Route path="/debug" component={Debug} />
        <Route path="/update" component={Updater} />
      </Router>
    </ErrorBoundary>
  ),
  document.getElementById("root") as HTMLElement
);
// render(() => <App />, document.getElementById("root") as HTMLElement);
