import type { Rule } from "./types";

export function fmtVal(v: unknown, r: Rule): string {
  if (r.type === "bool") return v ? "on" : "off";
  if (r.type === "enum") return String(v);
  if (r.type === "int") return String(v) + (r.unit ? " " + r.unit : "");
  if (r.type === "float") {
    const n = typeof v === "number" ? v : Number(v);
    return (Math.round(n * 1000) / 1000).toFixed(3) + (r.unit ? " " + r.unit : "");
  }
  return String(v);
}
