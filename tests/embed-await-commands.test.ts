/* spec/25 §12 — awaitable commands, host half.
 *
 * Gates A1–A5. The suite runs in `node` (no jsdom), so the handful of DOM APIs
 * the conductor touches — `window.addEventListener`, `document.createElement`,
 * `document.querySelector`, `location` — are stubbed here. The stub is small on
 * purpose: it exists to let the MESSAGE logic be exercised, not to imitate a
 * browser, and everything about actually rendering an iframe is verified in a
 * real browser downstream (la-cosa `dev/rgba-embed/run.mjs`, G43).
 *
 * ★ THE STUB SELF-CHECKS BEFORE ANYTHING ASSERTS ON IT (`stub sanity` below).
 * A fake window that silently swallowed messages would make every "the host did
 * not hang" test pass for the wrong reason — the failure this whole amendment
 * exists to prevent is an absence, and an absence is exactly what a broken
 * harness manufactures.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { COSO_PROTOCOL, isEnvelope, makeEnvelope, type UpMessage } from "@/embed/sdk/protocol";

type Listener = (ev: { origin: string; data: unknown; source: unknown }) => void;

let listeners: Listener[] = [];
let sent: unknown[] = [];
let iframeEl: Record<string, unknown> = {};
/** The fake guest window: whatever the conductor posts to an iframe lands here. */
const guestWindow = { postMessage: (data: unknown) => void sent.push(data) };

function installDom(): void {
  listeners = [];
  sent = [];
  const el: Record<string, unknown> = {
    style: {},
    setAttribute: () => {},
    contentWindow: guestWindow,
    parentNode: null,
  };
  iframeEl = el;
  (globalThis as Record<string, unknown>).location = { origin: "https://x.test", href: "https://x.test/p" };
  (globalThis as Record<string, unknown>).window = {
    addEventListener: (_t: string, cb: Listener) => void listeners.push(cb),
    removeEventListener: (_t: string, cb: Listener) => {
      listeners = listeners.filter((l) => l !== cb);
    },
  };
  (globalThis as Record<string, unknown>).document = {
    createElement: () => el,
    querySelector: () => el,
  };
}

/** Deliver an up-message as if the guest had posted it. */
function fromGuest(msg: UpMessage, token: string): void {
  const env = makeEnvelope("up", msg, token);
  for (const l of listeners) l({ origin: "https://x.test", data: env, source: guestWindow });
}

/** The token the conductor minted, read off the iframe URL it built.
 *
 *  ★ Not off a sent message: the conductor posts NOTHING until a `ready` bearing
 *  the correct token arrives, so reading the token from a send is circular —
 *  the first draft of this helper deadlocked exactly there. The URL is where the
 *  token genuinely originates. */
function mintedToken(): string {
  const src = iframeEl.src;
  if (typeof src !== "string") throw new Error("the conductor never set an iframe src");
  const t = new URL(src, "https://x.test/").searchParams.get("t");
  if (t === null || t === "") throw new Error(`no token in the iframe URL: ${src}`);
  return t;
}

async function makeEmbedded(features: string[] | undefined) {
  const { createConductor } = await import("@/embed/sdk/conductor");
  const c = createConductor({ runtime: "/embed.html" });
  const host = { appendChild: () => {} } as unknown as HTMLElement;
  const remote = c.embed(host, { substrate: "rgba" });
  const tok = mintedToken();
  // `ready` first: the conductor queues everything until the guest is listening.
  fromGuest({ kind: "ready", substrate: "rgba" }, tok);
  const mounted: UpMessage = {
    kind: "mounted",
    substrate: "rgba",
    lens: "press",
    playing: true,
    tunables: [],
    commands: [{ name: "record" }],
    ...(features === undefined ? {} : { features }),
  };
  fromGuest(mounted, tok);
  return { c, remote, tok };
}

beforeEach(() => {
  installDom();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------ stub sanity -- */

test("stub sanity — the harness really carries messages in both directions", async () => {
  const { remote, tok } = await makeEmbedded(["await_commands"]);
  // Host → guest: a play() must reach the fake guest window as OUR envelope.
  sent.length = 0;
  remote.play();
  expect(sent.length).toBe(1);
  expect(isEnvelope(sent[0])).toBe(true);
  expect((sent[0] as { msg: { kind: string } }).msg.kind).toBe("play");
  // Guest → host: a state push must reach the conductor's own accessor.
  fromGuest({ kind: "state", playing: false, tunables: { a: 1 } }, tok);
  expect(remote.isPlaying()).toBe(false);
  expect(remote.tunables()).toEqual({ a: 1 });
  // …and the negative control: a WRONG token must be ignored, so a test that
  // passes because "nothing arrived" is distinguishable from one that passes
  // because the right thing arrived.
  fromGuest({ kind: "state", playing: true, tunables: {} }, "not-the-token");
  expect(remote.isPlaying()).toBe(false);
});

/* -------------------------------------------------------------------- A1 --- */

test("A1 — an awaited command resolves with the lens's value once it reports back", async () => {
  const { remote, tok } = await makeEmbedded(["await_commands"]);
  sent.length = 0;
  const p = remote.command("record", 90);
  const env = sent[0] as { msg: { kind: string; name: string; requestId?: string } };
  expect(env.msg.kind).toBe("command");
  expect(env.msg.name).toBe("record");
  expect(typeof env.msg.requestId).toBe("string"); // the correlation the SDK never sent before §12

  let settled = false;
  void p.then(() => (settled = true));
  await Promise.resolve();
  expect(settled).toBe(false); // control: it does NOT resolve before the guest replies

  fromGuest({ kind: "result", requestId: env.msg.requestId!, value: "wrote 90 frames" }, tok);
  await expect(p).resolves.toBe("wrote 90 frames");
});

test("A1 control — a command with no return value still resolves (not promise-only)", async () => {
  const { remote, tok } = await makeEmbedded(["await_commands"]);
  sent.length = 0;
  const p = remote.command("defaults");
  const id = (sent[0] as { msg: { requestId: string } }).msg.requestId;
  fromGuest({ kind: "result", requestId: id }, tok);
  await expect(p).resolves.toBeUndefined();
});

/* -------------------------------------------------------------------- A2 --- */

test("★ A2 — a guest WITHOUT the feature resolves promptly instead of hanging", async () => {
  // The amendment's whole reason to exist. A deployed embed inlines a frozen
  // runtime, so it is old BY DEFINITION and can never send `result`.
  const { remote } = await makeEmbedded(undefined); // `mounted` carries no `features`
  sent.length = 0;
  const p = remote.command("record", 90);
  await expect(p).resolves.toBeUndefined(); // no guest reply, no timer, no hang
  // …and the command was still DELIVERED — degraded to fire-and-forget, not dropped.
  const env = sent[0] as { msg: { kind: string; name: string; requestId?: string } };
  expect(env.msg.kind).toBe("command");
  expect(env.msg.name).toBe("record");
  // No requestId: an old guest would echo nothing, and a correlatable id nobody
  // can answer is how the hang gets reintroduced.
  expect(env.msg.requestId).toBeUndefined();
});

test("A2 control — an EMPTY feature list is treated as 'cannot', not as 'unknown'", async () => {
  const { remote } = await makeEmbedded([]);
  await expect(remote.command("record")).resolves.toBeUndefined();
});

/* -------------------------------------------------------------------- A3 --- */

test("A3 — a failing command rejects the awaiting caller, correlated by requestId", async () => {
  const { remote, tok } = await makeEmbedded(["await_commands"]);
  sent.length = 0;
  const p = remote.command("record", 99999);
  const id = (sent[0] as { msg: { requestId: string } }).msg.requestId;
  fromGuest({ kind: "error", message: "samples out of range", requestId: id }, tok);
  await expect(p).rejects.toThrow(/samples out of range/);
});

test("A3 control — an UNCORRELATED error is still emitted and settles nobody", async () => {
  const { remote, tok } = await makeEmbedded(["await_commands"]);
  const seen: unknown[] = [];
  remote.on("error", (d) => void seen.push(d));
  sent.length = 0;
  const p = remote.command("record");
  fromGuest({ kind: "error", message: "unrelated failure" }, tok); // no requestId
  expect(seen.length).toBe(1);
  let settled = false;
  void p.then(
    () => (settled = true),
    () => (settled = true),
  );
  await Promise.resolve();
  expect(settled).toBe(false); // the pending command is untouched by someone else's error
});

/* -------------------------------------------------------------------- A4 --- */

test("★ A4 — a command that never reports back rejects on the timeout", async () => {
  const { remote } = await makeEmbedded(["await_commands"]);
  const { COMMAND_TIMEOUT_MS } = await import("@/embed/sdk/conductor");
  const p = remote.command("record");
  const assertion = expect(p).rejects.toThrow(/did not report back/);
  await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS + 1);
  await assertion;
});

test("A4 control — a command settling just inside the bound resolves normally", async () => {
  const { remote, tok } = await makeEmbedded(["await_commands"]);
  const { COMMAND_TIMEOUT_MS } = await import("@/embed/sdk/conductor");
  sent.length = 0;
  const p = remote.command("record");
  const id = (sent[0] as { msg: { requestId: string } }).msg.requestId;
  await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS - 10);
  fromGuest({ kind: "result", requestId: id, value: "ok" }, tok);
  await expect(p).resolves.toBe("ok");
  // The timer must not fire afterwards and reject an already-settled promise.
  await vi.advanceTimersByTimeAsync(1000);
});

test("A4b — destroy() rejects anything still in flight rather than stranding it", async () => {
  const { remote } = await makeEmbedded(["await_commands"]);
  const p = remote.command("record");
  const assertion = expect(p).rejects.toThrow(/destroyed/);
  remote.destroy();
  await assertion;
});

/* -------------------------------------------------------------------- A5 --- */

test("★ A5 — the protocol version is UNCHANGED, so no old artifact is silently orphaned", () => {
  // The gate that catches an accidental version bump. Its failure mode is
  // SILENCE: `isEnvelope` gates on strict equality of `proto`, so a `coso/v2`
  // would make every deployed guest and every new host ignore each other with
  // no error anywhere. Pinned to the literal, not to the constant — comparing
  // the constant to itself is a tautology that survives any bump.
  expect(COSO_PROTOCOL).toBe("coso/v1");
  const asAnOldGuestWouldSendIt = { proto: "coso/v1", dir: "up", msg: { kind: "ready", substrate: "rgba" } };
  expect(isEnvelope(asAnOldGuestWouldSendIt)).toBe(true);
  // Control: the gate can actually reject a version, so the assertion above is
  // not passing because `isEnvelope` waves everything through.
  expect(isEnvelope({ ...asAnOldGuestWouldSendIt, proto: "coso/v2" })).toBe(false);
});

test("A5b — `result` and `features` are additive: an old-shaped `mounted` still mounts", async () => {
  // A guest that predates §12 sends `mounted` with no `features`. It must still
  // produce a complete manifest — the field is optional, not merely tolerated.
  const { remote } = await makeEmbedded(undefined);
  const d = remote.describe();
  expect(d).not.toBeNull();
  expect(d!.lens).toBe("press");
  expect(d!.commands.map((c) => c.name)).toEqual(["record"]);
});
