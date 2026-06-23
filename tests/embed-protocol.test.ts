import { expect, test } from "vitest";
import { COSO_PROTOCOL, isEnvelope, makeEnvelope } from "@/embed/sdk/protocol";

test("makeEnvelope tags version+dir and omits token when absent", () => {
  const e = makeEnvelope("down", { kind: "play" });
  expect(e.proto).toBe(COSO_PROTOCOL);
  expect(e.dir).toBe("down");
  expect("token" in e).toBe(false);

  const t = makeEnvelope("up", { kind: "ready", substrate: "conway" }, "tok");
  expect(t.token).toBe("tok");
  expect(t.dir).toBe("up");
});

test("isEnvelope accepts our well-formed messages", () => {
  expect(isEnvelope(makeEnvelope("down", { kind: "play" }))).toBe(true);
  expect(isEnvelope(makeEnvelope("up", { kind: "state", playing: true }, "t"))).toBe(true);
  expect(
    isEnvelope(makeEnvelope("down", { kind: "set_tunable", path: ["theme"], value: "amber" })),
  ).toBe(true);
});

test("isEnvelope rejects foreign / malformed envelopes (security gate)", () => {
  expect(isEnvelope(null)).toBe(false);
  expect(isEnvelope(42)).toBe(false);
  expect(isEnvelope({})).toBe(false);
  expect(isEnvelope({ proto: "other/v9", dir: "down", msg: { kind: "play" } })).toBe(false);
  expect(isEnvelope({ proto: COSO_PROTOCOL, dir: "sideways", msg: { kind: "play" } })).toBe(false);
  expect(isEnvelope({ proto: COSO_PROTOCOL, dir: "down", msg: {} })).toBe(false); // no kind
  expect(isEnvelope({ proto: COSO_PROTOCOL, dir: "down", msg: null })).toBe(false);
  // a non-string token is structurally invalid
  expect(
    isEnvelope({ proto: COSO_PROTOCOL, dir: "down", token: 5, msg: { kind: "play" } }),
  ).toBe(false);
});

test("an unknown-but-well-formed kind passes the SHALLOW guard — surfaced at dispatch, not dropped", () => {
  // The guard gates foreign frames only; the dispatcher turns an unknown kind
  // into a visible `error` (spec point 1: never fail silently).
  expect(isEnvelope({ proto: COSO_PROTOCOL, dir: "down", msg: { kind: "bananas" } })).toBe(true);
});
