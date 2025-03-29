/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";

// import Root from './pages/root.tsx'
import App from "./pages/app.tsx";
import Start from "./pages/start.tsx";
import NotFound from "./pages/not_found.tsx";
import Debug from "./pages/debug.tsx";

import "./tailwind.css";

render(
  () => (
    <Router>
      <Route path="/app" component={App} />
      <Route path="/" component={Start} />
      <Route path="*" component={NotFound} />
      <Route path="/debug" component={Debug} />
    </Router>
  ),
  document.getElementById("root") as HTMLElement,
);
// render(() => <App />, document.getElementById("root") as HTMLElement);
