import type { Store } from "./store.js";
import type { Proposal } from "./types.js";

export interface ExecutionResult {
  status: "executed";
  action: Proposal["action"];
  reference: string;
  amount: number;
  duplicate: boolean;
}

/**
 * Step 7: run an approved write action exactly once. The idempotency key ties the
 * action to the ticket + order, so retries or replayed approvals never double-refund.
 */
export function executeAction(store: Store, ticketId: string, p: Proposal): ExecutionResult {
  const key = `${ticketId}-${p.orderId}-${p.action}`;
  const order = store.order(p.orderId);
  if (!order) throw new Error(`order ${p.orderId} not found`);

  if (p.action === "refund") {
    const existing = store.state.refunds.find((r) => r.idempotencyKey === key);
    if (existing) return { status: "executed", action: "refund", reference: existing.id, amount: existing.amount, duplicate: true };
    const record = { id: store.nextId("rf"), idempotencyKey: key, orderId: order.id, amount: p.amount, reasonCode: p.reasonCode, at: new Date().toISOString() };
    store.state.refunds.push(record);
    order.refunded += p.amount;
    return { status: "executed", action: "refund", reference: record.id, amount: p.amount, duplicate: false };
  }

  const existing = store.state.replacements.find((r) => r.idempotencyKey === key);
  if (existing) return { status: "executed", action: "replacement", reference: existing.id, amount: p.amount, duplicate: true };
  const record = { id: store.nextId("rp"), idempotencyKey: key, orderId: order.id, item: order.item, at: new Date().toISOString() };
  store.state.replacements.push(record);
  return { status: "executed", action: "replacement", reference: record.id, amount: p.amount, duplicate: false };
}
