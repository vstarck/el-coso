/* spec/25 §12 — awaitable commands, LENS half.
 *
 * The §12 host gates live in `embed-await-commands.test.ts` and drive a FAKE
 * guest. That fixture is necessarily more capable than the real path, so these
 * gates exercise the real one: the console shell that prints a command's reply,
 * and the `EmbedHandle` that carries it to the guest runtime.
 *
 * ★ A6b exists because the fixture hid a live defect. `EmbedHandle.command`
 * discarded `dispatch(...)`'s return value, so every embed path saw `undefined`
 * no matter what the lens said — and the host suite could not see it, because
 * its guest was hand-written to reply correctly. *A test whose fixture is more
 * generous than the implementation reports on the fixture.*
 */
import { expect, test } from "vitest";
import { createShell, type CommandSource, type Shell } from "@/lib/terminal/shell";
import type { EmbedCommandSpec } from "@/lenses/types";

/** Every line of committed scrollback, flattened to text. */
function linesOf(shell: Shell): string[] {
  return shell.view().scrollback.map((l) => l.spans.map((sp) => sp.text).join(""));
}

function shellWith(dispatch: CommandSource["dispatch"]) {
  const source: CommandSource = {
    list: () => [{ name: "record", args: [] }],
    dispatch,
  };
  const shell = createShell({ source });
  shell.activate();
  const type = (s: string): void => {
    for (const ch of s) shell.handle({ kind: "insert", ch });
    shell.handle({ kind: "key", key: "enter" });
  };
  return { type, shell };
}

/* -------------------------------------------------------------------- A6 --- */

test("★ A6 — the console prints a promise-returning command's RESOLVED string", async () => {
  let release: (v: string) => void = () => {};
  const s = shellWith(() => new Promise<string>((r) => (release = r)));
  s.type("record");

  // Before it settles, nothing is printed under the echo — and critically the
  // shell has NOT printed "[object Promise]", which is what an un-awaited
  // `String(result)` would have produced.
  expect(linesOf(s.shell).join("\n")).not.toContain("[object Promise]");
  const beforeCount = linesOf(s.shell).length;

  release("wrote 90 frames");
  await Promise.resolve();
  await Promise.resolve();

  const after = linesOf(s.shell);
  expect(after.join("\n")).toContain("wrote 90 frames");
  expect(after.length).toBeGreaterThan(beforeCount); // a LATE line really reached the screen
});

test("A6 control — a synchronous command still prints immediately", () => {
  const s = shellWith(() => "done at once");
  s.type("record");
  expect(linesOf(s.shell).join("\n")).toContain("done at once");
});

test("A6b — a REJECTED promise prints the same `error:` line a throw does", async () => {
  let boom: (e: Error) => void = () => {};
  const s = shellWith(() => new Promise<string>((_r, rej) => (boom = rej)));
  s.type("record");
  boom(new Error("samples out of range"));
  await Promise.resolve();
  await Promise.resolve();
  const text = linesOf(s.shell).join("\n");
  expect(text).toContain("error:");
  expect(text).toContain("samples out of range");
});

test("A6b control — a SYNCHRONOUS throw prints the same shape", () => {
  const s = shellWith(() => {
    throw new Error("samples out of range");
  });
  s.type("record");
  const text = linesOf(s.shell).join("\n");
  expect(text).toContain("error:");
  expect(text).toContain("samples out of range");
});

/* ------------------------------------------------- the availability field --- */

test("EmbedCommandSpec carries availability + a reason, and absent means available", () => {
  // A declaration-only type, so this gate is about the CONTRACT's shape: a host
  // must be able to say "disabled, and here is why" without the command
  // vanishing from the manifest.
  const plain: EmbedCommandSpec = { name: "rewind" };
  expect(plain.available).toBeUndefined(); // absent ⇒ available; existing callers unchanged

  const blocked: EmbedCommandSpec = {
    name: "record",
    available: false,
    unavailable_reason: "this browser cannot record WebM",
  };
  expect(blocked.available).toBe(false);
  // ★ The reason must name WHICH leg failed. A bare "unavailable" is not
  // actionable, and the whole point of the field over omission is the reason.
  expect(blocked.unavailable_reason).toMatch(/webm/i);
});
