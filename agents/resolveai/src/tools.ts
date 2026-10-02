import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Store } from "./store.js";
import { RefundInput, ReplacementInput, type Proposal } from "./types.js";

// Step 4 tools. Read tools run freely; write tools only produce *proposals*
// that the agent loop sends through the policy engine.

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

const REASONS = ["damaged", "not_received", "wrong_item", "late", "return", "goodwill"];

export const READ_TOOLS: BetaTool[] = [
  {
    name: "get_order",
    description: "Look up one of the current customer's orders: item, total, amount already refunded, dates and status. Always call this before making any claim about an order.",
    strict: true,
    input_schema: obj({ order_id: { type: "string", description: "Order ID, e.g. A1042" } }, ["order_id"]),
  },
  {
    name: "list_orders",
    description: "List the current customer's recent orders. Use when the customer didn't give an order ID.",
    strict: true,
    input_schema: obj({}, []),
  },
  {
    name: "track_shipment",
    description: "Carrier tracking events and any carrier notes (e.g. damage or loss reports) for one of the customer's orders.",
    strict: true,
    input_schema: obj({ order_id: { type: "string" } }, ["order_id"]),
  },
  {
    name: "search_kb",
    description: "Search help-center and policy articles. Returns article IDs to cite when proposing an action.",
    strict: true,
    input_schema: obj({ query: { type: "string" } }, ["query"]),
  },
];

export const WRITE_TOOLS: BetaTool[] = [
  {
    name: "issue_refund",
    description: "PROPOSE a full or partial refund to the original payment method. This is checked against policy and may need human approval before it runs; the result tells you what actually happened.",
    strict: true,
    input_schema: obj(
      {
        order_id: { type: "string" },
        amount: { type: "number", description: "In USD. Must not exceed order total minus prior refunds." },
        reason_code: { type: "string", enum: REASONS },
        kb_article_id: { type: "string", description: "Policy article justifying the refund" },
        justification: { type: "string", description: "One or two sentences for the human reviewer" },
      },
      ["order_id", "amount", "reason_code", "kb_article_id", "justification"],
    ),
  },
  {
    name: "create_replacement",
    description: "PROPOSE shipping a free replacement of the ordered item. Checked against policy like a refund.",
    strict: true,
    input_schema: obj(
      {
        order_id: { type: "string" },
        reason_code: { type: "string", enum: REASONS },
        kb_article_id: { type: "string" },
        justification: { type: "string" },
      },
      ["order_id", "reason_code", "kb_article_id", "justification"],
    ),
  },
];

export const ESCALATE_TOOL: BetaTool = {
  name: "escalate_to_human",
  description: "Hand the ticket to a human agent with a short summary. Use when you can't resolve the issue within policy or the customer asks for a person.",
  strict: true,
  input_schema: obj({ summary: { type: "string" } }, ["summary"]),
};

export function toolsFor(mode: "faq" | "order"): BetaTool[] {
  return mode === "faq" ? [READ_TOOLS[3], ESCALATE_TOOL] : [...READ_TOOLS, ...WRITE_TOOLS, ESCALATE_TOOL];
}

export type ToolOutcome =
  | { kind: "result"; content: string; isError?: boolean }
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "escalate"; summary: string };

const json = (v: unknown): ToolOutcome => ({ kind: "result", content: JSON.stringify(v) });
const error = (message: string): ToolOutcome => ({ kind: "result", content: JSON.stringify({ error: message }), isError: true });

/** Execute a tool call, scoped to the identified customer. */
export function runTool(store: Store, customerId: string, name: string, input: unknown): ToolOutcome {
  const args = (input ?? {}) as Record<string, unknown>;
  const ownOrder = (id: unknown) => {
    const order = typeof id === "string" ? store.order(id) : undefined;
    // Same message for "missing" and "someone else's": don't leak that the order exists.
    return order && order.customerId === customerId ? order : undefined;
  };

  switch (name) {
    case "get_order": {
      const o = ownOrder(args.order_id);
      if (!o) return error(`No order ${String(args.order_id)} found for this customer. Ask the customer to confirm the order ID.`);
      return json({ ...o, refundable: +(o.total - o.refunded).toFixed(2) });
    }
    case "list_orders":
      return json(store.ordersFor(customerId).map(({ id, item, total, status, deliveredAt }) => ({ id, item, total, status, deliveredAt })));
    case "track_shipment": {
      const o = ownOrder(args.order_id);
      const s = o && store.shipment(o.id);
      if (!s) return error(`No tracking found for ${String(args.order_id)}.`);
      return json(s);
    }
    case "search_kb":
      return json(searchKb(store, String(args.query ?? "")));
    case "issue_refund": {
      const parsed = RefundInput.safeParse(args);
      if (!parsed.success) return error(`Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      const p = parsed.data;
      if (!ownOrder(p.order_id)) return error(`No order ${p.order_id} found for this customer.`);
      return { kind: "proposal", proposal: { action: "refund", orderId: p.order_id.toUpperCase(), amount: p.amount, reasonCode: p.reason_code, kbArticleId: p.kb_article_id, justification: p.justification } };
    }
    case "create_replacement": {
      const parsed = ReplacementInput.safeParse(args);
      if (!parsed.success) return error(`Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      const p = parsed.data;
      const o = ownOrder(p.order_id);
      if (!o) return error(`No order ${p.order_id} found for this customer.`);
      return { kind: "proposal", proposal: { action: "replacement", orderId: o.id, amount: o.total, reasonCode: p.reason_code, kbArticleId: p.kb_article_id, justification: p.justification } };
    }
    case "escalate_to_human":
      return { kind: "escalate", summary: String(args.summary ?? "") };
    default:
      return error(`Unknown tool ${name}`);
  }
}

/** Keyword-overlap search over the knowledge base. Good enough for the demo corpus. */
export function searchKb(store: Store, query: string) {
  const q = query.toLowerCase();
  const words = q.split(/\W+/).filter((w) => w.length > 2);
  return store.state.kb
    .map((a) => {
      const score = a.keywords.reduce((s, k) => s + (q.includes(k) ? 2 : 0), 0) + words.filter((w) => a.title.toLowerCase().includes(w)).length;
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .map(({ a }) => ({ id: a.id, title: a.title, body: a.body }));
}
