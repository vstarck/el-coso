import type { Rule } from "@/lib/types";

/**
 * How the chrome should paint an enum choice.
 *
 * ★ EXTRACTED SO IT CAN BE GATED AT ALL. The rail is React and the suite is
 * `environment: "node"` with no jsdom, so nothing rendered in `RulesRail.tsx` is
 * reachable by a test. The DECISION is the part worth protecting — a rendering rule
 * that silently stops applying looks exactly like a styling preference — so it lives
 * here as a pure function over the rule, and `RulesRail` only obeys it.
 *
 * The rule: an explicit `display` always wins; absent one, more than two options paint
 * as a vertical list. A horizontal segmented group is right for a binary or a tight
 * ternary and wrong past that — wacha's `Draw` has five sources and the last one was
 * clipped off the panel edge, which is the case this exists for.
 *
 * ⚠ `"segmented"` IS NOW MEANINGFUL WHERE IT USED TO BE REDUNDANT. It was the
 * documented default, so every substrate that wrote it explicitly kept exactly the
 * behaviour it had; what changed is what OMITTING it means. That asymmetry is the
 * whole migration: nothing that declared its intent moves, and only the rules that
 * never expressed one are re-decided.
 */
export function enumDisplay(
  rule: Extract<Rule, { type: "enum" }>,
): "segmented" | "list" {
  if (rule.display !== undefined) return rule.display;
  return rule.options.length > 2 ? "list" : "segmented";
}
