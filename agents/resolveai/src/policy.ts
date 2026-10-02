import type { Decision, Order, Proposal, ReasonCode } from "./types.js";

export interface PolicyContext {
  order: Order;
  fraudSignal: boolean;
  refunds90d: number;
  now?: Date;
}

export const POLICY = {
  windowDays: 30,
  approvalThreshold: 100,
  goodwillThreshold: 20,
  maxRefunds90d: 3,
} as const;

const DEFECT_REASONS: ReasonCode[] = ["damaged", "wrong_item", "not_received"];

/**
 * Step 5: every proposed write action passes through here. Rules are evaluated in
 * order and the first match wins, mirroring the table on the portfolio page.
 */
export function evaluate(p: Proposal, ctx: PolicyContext): Decision {
  const { order } = ctx;
  const now = ctx.now ?? new Date();

  // 1. Never refund more than is left on the order.
  const remaining = order.total - order.refunded;
  if (p.action === "refund" && p.amount > remaining + 1e-9) {
    return { outcome: "deny", rule: 1, reasons: [`amount $${p.amount.toFixed(2)} exceeds refundable $${remaining.toFixed(2)}`] };
  }

  // 2. Risky history always gets a human.
  if (ctx.fraudSignal || ctx.refunds90d >= POLICY.maxRefunds90d) {
    return { outcome: "needs_approval", rule: 2, reasons: [ctx.fraudSignal ? "fraud signal on account" : `${ctx.refunds90d} refunds in the last 90 days`] };
  }

  // 3. Outside the return window for non-defect reasons.
  const ref = order.deliveredAt ?? order.placedAt;
  const ageDays = (now.getTime() - Date.parse(ref)) / 86_400_000;
  if (ageDays > POLICY.windowDays && !DEFECT_REASONS.includes(p.reasonCode)) {
    return {
      outcome: "deny",
      rule: 3,
      reasons: [`order is ${Math.floor(ageDays)} days old (window is ${POLICY.windowDays} days)`],
      alternative: "store_credit",
    };
  }

  // 4. High value.
  if (p.amount > POLICY.approvalThreshold) {
    return { outcome: "needs_approval", rule: 4, reasons: [`${p.action} value $${p.amount.toFixed(2)} > $${POLICY.approvalThreshold}`] };
  }

  // 5. Goodwill gestures above a small limit.
  if (p.reasonCode === "goodwill" && p.amount > POLICY.goodwillThreshold) {
    return { outcome: "needs_approval", rule: 5, reasons: [`goodwill over $${POLICY.goodwillThreshold}`] };
  }

  // 6. Everything else within policy.
  return { outcome: "allow", rule: 6 };
}
