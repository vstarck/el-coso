/* The gallery PREVIEW (S251): a substrate's still (`meta.thumbnail`) and its hover clip (`meta.preview`) are URLs to
 * files shipped BESIDE the code, never imports — an import lands in a bundle (the embed build base64-inlines every import, the app build any under 4 KB). The card carries both
 * through. The resolver the dev server and the build share is gated in gallery-preview-files.test.mjs (it needs
 * node's fs, which this project's tsc does not type). */
import { describe, expect, it } from "vitest";
import { galleryCards, registerSubstrates, SUBSTRATE_BY_ID, type SubstrateModule } from "@/app/substrates";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fake = (id: string, meta: Partial<SubstrateModule["meta"]> = {}): SubstrateModule => ({
  bundle: {} as any, adapter: {} as any, lenses: {}, defaultLensId: "x", parseLevel: (j) => j,
  puzzles: [{ id: `${id}-0`, description: "" }],
  meta: { id, name: id, defaultPuzzle: `${id}-0`, keyframePeriod: 100, ...meta },
});
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("the card carries the still and the clip", () => {
  it("projects meta.thumbnail and meta.preview through the entry onto the card", () => {
    registerSubstrates([fake("zzz-preview", { thumbnail: "/previews/zzz-preview/still.webp", preview: "/previews/zzz-preview/clip.webm" })]);
    expect(SUBSTRATE_BY_ID["zzz-preview"]!.preview).toBe("/previews/zzz-preview/clip.webm");
    const card = galleryCards().find((c) => c.key === "zzz-preview")!;
    expect([card.thumbnail, card.preview]).toEqual(["/previews/zzz-preview/still.webp", "/previews/zzz-preview/clip.webm"]);
  });
  it("a substrate without them has neither (the placeholder tile)", () => {
    registerSubstrates([fake("zzz-plain")]);
    const card = galleryCards().find((c) => c.key === "zzz-plain")!;
    expect([card.thumbnail, card.preview]).toEqual([undefined, undefined]);
  });
});
