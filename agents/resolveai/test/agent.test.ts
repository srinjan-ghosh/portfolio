import { beforeEach, describe, expect, it } from "vitest";
import { handleMessage, resolveApproval, type Deps } from "../src/agent.js";
import { executeAction } from "../src/execute.js";
import { MockLLM } from "../src/llm.js";
import { Store } from "../src/store.js";

let deps: Deps;
beforeEach(() => {
  deps = { store: new Store(null), llm: new MockLLM() };
});

describe("agent workflow (mock LLM)", () => {
  it("A1042: $249 damaged-item refund pauses for approval, then executes once", async () => {
    const t = await handleMessage(deps, { email: "alex@example.com", text: "My headphones (order A1042) arrived with a cracked headband. Refund please." });
    expect(t.status).toBe("awaiting_approval");
    expect(deps.store.state.refunds).toHaveLength(0);

    const approval = deps.store.state.approvals[0];
    expect(approval.card.rule).toMatch(/Rule 4/);
    await resolveApproval(deps, approval.id, { decision: "approve", reviewer: "Priya" });

    expect(t.status).toBe("resolved");
    expect(deps.store.state.refunds).toHaveLength(1);
    expect(deps.store.order("A1042")!.refunded).toBe(249);
    expect(t.messages.at(-1)!.text).toContain(deps.store.state.refunds[0].id);

    // Replaying the same action is idempotent.
    const again = executeAction(deps.store, t.id, approval.card.proposal);
    expect(again.duplicate).toBe(true);
    expect(deps.store.state.refunds).toHaveLength(1);
    // And the approval can't be applied twice.
    await expect(resolveApproval(deps, approval.id, { decision: "approve", reviewer: "Priya" })).rejects.toThrow(/already/);
  });

  it("a reviewer can edit the amount", async () => {
    await handleMessage(deps, { email: "alex@example.com", text: "Order A1042 arrived damaged" });
    await resolveApproval(deps, deps.store.state.approvals[0].id, { decision: "approve", reviewer: "Priya", amount: 120 });
    expect(deps.store.state.refunds[0].amount).toBe(120);
  });

  it("a rejection is relayed to the customer without any refund", async () => {
    const t = await handleMessage(deps, { email: "alex@example.com", text: "Order A1042 arrived damaged" });
    await resolveApproval(deps, deps.store.state.approvals[0].id, { decision: "reject", reviewer: "Priya", note: "a replacement was already sent" });
    expect(deps.store.state.refunds).toHaveLength(0);
    expect(t.messages.at(-1)!.text).toContain("a replacement was already sent");
  });

  it("small refund within policy is auto-approved", async () => {
    const t = await handleMessage(deps, { email: "alex@example.com", text: "My phone case, order A1077, arrived cracked." });
    expect(t.status).toBe("resolved");
    expect(deps.store.state.approvals).toHaveLength(0);
    expect(deps.store.state.refunds[0]).toMatchObject({ orderId: "A1077", amount: 19 });
  });

  it("out-of-window return is denied and store credit is offered", async () => {
    const t = await handleMessage(deps, { email: "alex@example.com", text: "I'd like to return my rain jacket, order A0950." });
    expect(t.status).toBe("resolved");
    expect(deps.store.state.refunds).toHaveLength(0);
    expect(t.trace.some((e) => e.label === "policy" && /deny/.test(e.text))).toBe(true);
    expect(t.messages.at(-1)!.text).toMatch(/store credit/i);
  });

  it("customer with 3+ refunds in 90 days needs approval even for small amounts", async () => {
    const t = await handleMessage(deps, { email: "sam@example.com", text: "Desk lamp C3005 arrived broken." });
    expect(t.status).toBe("awaiting_approval");
    expect(deps.store.state.approvals[0].card.rule).toMatch(/Rule 2/);
  });

  it("legal threats go straight to a human", async () => {
    const t = await handleMessage(deps, { email: "alex@example.com", text: "Order A1042 arrived broken and I'm calling my lawyer." });
    expect(t.status).toBe("escalated");
    expect(deps.store.state.runs).toHaveLength(0);
  });

  it("can't act on another customer's order", async () => {
    const t = await handleMessage(deps, { email: "alex@example.com", text: "Order B2001 arrived damaged, refund it." });
    expect(deps.store.state.refunds).toHaveLength(0);
    expect(t.messages.at(-1)!.text).toMatch(/couldn't find order B2001/);
  });

  it("FAQ questions are answered from the knowledge base", async () => {
    const t = await handleMessage(deps, { email: "jordan@example.com", text: "How do I reset my password?" });
    expect(t.route).toBe("faq");
    expect(t.messages.at(-1)!.text).toMatch(/Forgot password/);
  });

  it("unknown senders are escalated for identity verification", async () => {
    const t = await handleMessage(deps, { email: "nobody@example.com", text: "Refund my order" });
    expect(t.status).toBe("escalated");
  });
});
