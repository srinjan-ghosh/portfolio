import type { Customer, Route, Triage } from "./types.js";

// Step 3: plain code, not the LLM, picks the path.
export function route(t: Triage, c: Customer): Route {
  if (t.risk_flags.length > 0) return "human";
  if (c.fraudSignal) return "human";
  if (t.confidence < 0.7) return "human";
  if (c.tier === "vip" && t.sentiment === "angry") return "human";
  if (["product_question", "account"].includes(t.intent)) return "faq";
  return "order_agent";
}
