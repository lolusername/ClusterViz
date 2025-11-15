import { render } from "solid-js/web";
import App from "./App";
import "./index.css";
import { registerVisualizations } from "./lib/ml/registerAll";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

registerVisualizations();

render(() => <App />, root);
