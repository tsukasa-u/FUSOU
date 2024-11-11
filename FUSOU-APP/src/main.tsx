/* @refresh reload */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";

import App from './pages/app.tsx'
import Start from './pages/start.tsx'
import NotFound from "./pages/not_found.tsx";

import './tailwind.css'
import { JSX } from "solid-js";

const Root = (props: {children: JSX.Element}) => (
    <>
      {props.children}
    </>
);

render(
    () => (
        <Router root={Root}>
            <Route path="/app" component={App} />
            <Route path="/" component={Start} />
            <Route path="*paramName" component={NotFound} />
        </Router>
    ),
    document.getElementById("root") as HTMLElement
);
// render(() => <App />, document.getElementById("root") as HTMLElement);
