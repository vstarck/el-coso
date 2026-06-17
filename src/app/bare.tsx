/* Bare host — the substrate in a single full-viewport DOM node, no chrome.
 *
 * The same `SubstrateHost` the full app (`App.tsx`) mounts, minus every
 * chrome panel (toolbar, inspector, rules rail, timeline) and overlay. This
 * is the browser twin of the engine's `runHeadless`: an
 * embeddable, playable substrate with no editor UI — drop it in an iframe,
 * or use it to eyeball a lens in isolation.
 *
 * Selection comes from the URL exactly as the full app does:
 *   bare.html?substrate=<id>&puzzle=<id>&lens=<id>
 * (importing `session` runs the URL-driven scene-stack init at load time.)
 *
 * AUTOPLAY substrates start running on mount — SubstrateHost flips
 * `store.playing` when the mounted lens declares the feature. Turn-based
 * substrates advance on their own input (keyboard / click) with no transport
 * controls, since there is no toolbar here to host them.
 */

import React, { useLayoutEffect } from "react";
import ReactDOM from "react-dom/client";
import { SubstrateHost } from "./components/canvas/SubstrateHost";
import { applyLensTheme } from "@/lib/accentTheme";
import { session } from "./session";
import { useStore } from "./store";
import "./styles/globals.css";

// No chrome panels in bare mode, so the lens gets the entire viewport for
// its SAFE_AREA inset (nothing to dodge). SubstrateHost reads panel state to
// compute that inset, so close them before the first mount.
useStore.setState({
  panels: { toolbar: false, inspector: false, rules: false, timeline: false },
});

function BareApp() {
  // Apply the active lens's accent on mount + on any substrate/lens swap
  // (the URL can't swap mid-session here, but keep parity with App.tsx so a
  // future deep-link reload behaves identically).
  const theme = useStore((s) => s.theme);
  const sessionVersion = useStore((s) => s.sessionVersion);
  useLayoutEffect(() => {
    applyLensTheme(session.active_lens, theme);
  }, [theme, sessionVersion]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <SubstrateHost />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BareApp />
  </React.StrictMode>,
);
