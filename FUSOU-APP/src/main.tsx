/* @refresh reload */
import { render } from "solid-js/web";
import App from './app.tsx'

import './index.css'
import './tailwind.css'

render(() => <App />, document.getElementById("root") as HTMLElement);
