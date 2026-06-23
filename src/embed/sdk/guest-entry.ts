/* Build entry for the iframe guest page (dist-embed/embed.html). Side-effecting:
 * starts the guest once the DOM is ready. Built via vite.embed.config.ts with
 * COSO_EMBED_ENTRY=src/embed/sdk/guest-entry.ts; the exporter inlines the result
 * into embed.html. See spec/25. */

import { startEmbedGuest } from "./runtime";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => startEmbedGuest(), { once: true });
} else {
  startEmbedGuest();
}
