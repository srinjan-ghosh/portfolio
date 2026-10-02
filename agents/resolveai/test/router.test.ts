import { describe, expect, it } from "vitest";
import { route } from "../src/router.js";
import type { Customer, Triage } from "../src/types.js";

const t = (x: Partial<Triage> = {}): Triage => ({ intent: "damaged_item", entities: { order_ids: [], products: [] }, urgency: "normal", sentiment: "neutral", risk_flags: [], confidence: 0.9, ...x });
const c = (x: Partial<Customer> = {}): Customer => ({ id: "c", email: "e", name: "n", tier: "standard", fraudSignal: false, priorRefunds90d: 0, ...x });

describe("router", () => {
  it("sends risk flags to a human", () => expect(route(t({ risk_flags: ["legal"] }), c())).toBe("human"));
  it("sends low confidence to a human", () => expect(route(t({ confidence: 0.5 }), c())).toBe("human"));
  it("sends angry VIPs to a human", () => expect(route(t({ sentiment: "angry" }), c({ tier: "vip" }))).toBe("human"));
  it("keeps angry standard customers with the agent", () => expect(route(t({ sentiment: "angry" }), c())).toBe("order_agent"));
  it("routes product and account questions to FAQ", () => {
    expect(route(t({ intent: "product_question" }), c())).toBe("faq");
    expect(route(t({ intent: "account" }), c())).toBe("faq");
  });
  it("routes order issues to the order agent", () => expect(route(t({ intent: "order_status" }), c())).toBe("order_agent"));
});
