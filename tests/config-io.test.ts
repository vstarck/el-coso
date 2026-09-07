import { describe, expect, it } from "vitest";
import { buildDump, planApply } from "../src/app/components/chrome/config-io";
import type { LensTunable } from "../src/lenses/types";

const t = (id: string, extra: Partial<LensTunable> = {}): LensTunable => ({
  id, group: "g", label: id, type: "float", min: 0, max: 10, step: 1,
  target: "lens", path: ["ls", id], ...extra,
} as LensTunable);

const TUNABLES = [t("a"), t("b"), t("c")];
const META = { substrate: "wacha", lens: "ball" };

describe("buildDump", () => {
  it("writes every readable id and OMITS an unreadable one", () => {
    const d = buildDump({ ...META, puzzle: "p" }, TUNABLES,
      (x) => (x.id === "c" ? undefined : x.id === "a" ? 1 : "two"));
    expect(d.tunables).toEqual({ a: 1, b: "two" });
    expect("c" in d.tunables, "an unreadable id was written as a hole").toBe(false);
    expect(d).toMatchObject({ substrate: "wacha", lens: "ball", puzzle: "p" });
  });
});

describe("planApply", () => {
  it("round-trips a dump of itself into one write per id", () => {
    const d = buildDump(META, TUNABLES, () => 3);
    const p = planApply(d, META, TUNABLES);
    expect(p.mismatch).toBeNull();
    expect(p.problems).toEqual([]);
    expect(p.writes.map((w) => w.id).sort()).toEqual(["a", "b", "c"]);
    // the write carries the PATH, so the caller pushes it through the same
    // `setTunable` a slider uses rather than inventing a second route
    expect(p.writes[0]!.path).toEqual(["ls", "a"]);
  });

  it("refuses a FOREIGN payload whole, rather than applying the keys that match", () => {
    const foreign = { substrate: "marea", lens: "ball", tunables: { a: 1, b: 2 } };
    const p = planApply(foreign, META, TUNABLES);
    expect(p.mismatch).toContain("marea");
    // the load-bearing half: nothing is written, so a paste into the wrong substrate
    // cannot leave a world that belongs to neither
    expect(p.writes, "a foreign payload produced writes").toEqual([]);
  });

  it("refuses a foreign LENS the same way", () => {
    const p = planApply({ substrate: "wacha", lens: "other", tunables: { a: 1 } }, META, TUNABLES);
    expect(p.mismatch).toContain("other");
    expect(p.writes).toEqual([]);
  });

  it("reports an unknown knob by name and still applies the known ones", () => {
    const p = planApply({ ...META, tunables: { a: 1, nope: 2 } }, META, TUNABLES);
    expect(p.mismatch).toBeNull();
    expect(p.problems.join(" ")).toContain("nope");
    expect(p.writes.map((w) => w.id), "a known id was dropped alongside the unknown one")
      .toEqual(["a"]);
  });

  it("refuses a non-tunable VALUE by name", () => {
    const p = planApply({ ...META, tunables: { a: { deep: 1 }, b: 2 } }, META, TUNABLES);
    expect(p.problems.join(" ")).toContain("a");
    expect(p.writes.map((w) => w.id)).toEqual(["b"]);
  });

  it("rejects junk that is not a config object at all", () => {
    for (const junk of [null, 42, "x", [1, 2]]) {
      expect(planApply(junk, META, TUNABLES).mismatch, `junk: ${JSON.stringify(junk)}`)
        .not.toBeNull();
    }
    // and a well-shaped object with no `tunables` is a mismatch, not an empty apply —
    // otherwise pasting `{}` reads as success while doing nothing
    expect(planApply({}, META, TUNABLES).mismatch).toContain("tunables");
  });

  it("a payload with NO substrate/lens stamp is accepted — the sandbox's own dumps", () => {
    // the stamp is a guard against the wrong substrate, not a required envelope; a
    // hand-written `{tunables:{…}}` must still load or the panel is unusable for the
    // thing people actually paste
    const p = planApply({ tunables: { a: 5 } }, META, TUNABLES);
    expect(p.mismatch).toBeNull();
    expect(p.writes).toEqual([{ id: "a", value: 5, path: ["ls", "a"] }]);
  });
});
