import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { chromePanelsFor, session } from "./session";
import { useStore } from "./store";
import "./styles/globals.css";

// Apply the initial substrate's chrome panel defaults before first paint
// (substrate switches re-apply via the toolbar). Without this the store's
// all-open default would flash before the substrate's layout takes effect.
useStore
  .getState()
  .applyChromePanels(chromePanelsFor(session.active_substrate_id));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
