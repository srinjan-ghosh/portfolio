import { describe, expect, it } from "vitest";
import { evaluate } from "../src/policy.js";
import type { Order, Proposal } from "../src/types.js";

const now = new Date("2026-10-01T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const order = (o: Partial<Order> = {}): Order => ({ id: "A1", customerId: "c", item: "Thing", total: 249, refunded: 0, placedAt: daysAgo(6), deliveredAt: daysAgo(2), status: "delivered", ...o });
const refund = (p: Partial<Proposal> = {}): Proposal => ({ action: "refund", orderId: "A1", amount: 50, reasonCode: "damaged", kbArticleId: "kb_112", justification: "x", ...p });
const ctx = (o: Partial<Order> = {}, extra: { fraudSignal?: boolean; refunds90d?: number } = {}) => ({ order: order(o), fraudSignal: false, refunds90d: 0, now, ...extra });

describe("policy engine", () => {
  it("rule 1: denies refunds above the refundable balance", () => {
    expect(evaluate(refund({ amount: 200 }), ctx({ total: 249, refunded: 100 }))).toMatchObject({ outcome: "deny", rule: 1 });
  });
  it("rule 2: risky history needs approval even for small amounts", () => {
    expect(evaluate(refund({ amount: 10 }), ctx({}, { refunds90d: 3 }))).toMatchObject({ outcome: "needs_approval", rule: 2 });
    expect(evaluate(refund({ amount: 10 }), ctx({}, { fraudSignal: true }))).toMatchObject({ outcome: "needs_approval", rule: 2 });
  });
  it("rule 3: denies non-defect refunds after 30 days and offers store credit", () => {
    expect(evaluate(refund({ reasonCode: "return" }), ctx({ deliveredAt: daysAgo(45) }))).toMatchObject({ outcome: "deny", rule: 3, alternative: "store_credit" });
  });
  it("rule 3 does not apply to defects", () => {
    expect(evaluate(refund({ reasonCode: "damaged", amount: 20 }), ctx({ deliveredAt: daysAgo(45) }))).toMatchObject({ outcome: "allow" });
  });
  it("rule 4: high value needs approval", () => {
    expect(evaluate(refund({ amount: 249 }), ctx())).toMatchObject({ outcome: "needs_approval", rule: 4 });
    expect(evaluate({ ...refund(), action: "replacement", amount: 150 }, ctx())).toMatchObject({ outcome: "needs_approval", rule: 4 });
  });
  it("rule 5: goodwill over $20 needs approval", () => {
    expect(evaluate(refund({ reasonCode: "goodwill", amount: 25 }), ctx())).toMatchObject({ outcome: "needs_approval", rule: 5 });
  });
  it("rule 6: allows everything else", () => {
    expect(evaluate(refund({ amount: 19 }), ctx())).toEqual({ outcome: "allow", rule: 6 });
  });
  it("first matching rule wins (1 before 4)", () => {
    expect(evaluate(refund({ amount: 300 }), ctx())).toMatchObject({ rule: 1 });
  });
});
