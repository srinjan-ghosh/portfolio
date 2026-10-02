import { describe, expect, it } from "vitest";
import { Store } from "../src/store.js";
import { runTool, searchKb, toolsFor } from "../src/tools.js";

describe("tools", () => {
  const store = new Store(null);

  it("scopes order lookups to the identified customer", () => {
    expect(runTool(store, "cust_5521", "get_order", { order_id: "A1042" })).toMatchObject({ kind: "result" });
    const other = runTool(store, "cust_5521", "get_order", { order_id: "B2001" });
    expect(other).toMatchObject({ kind: "result", isError: true });
    expect(runTool(store, "cust_5521", "track_shipment", { order_id: "B2001" })).toMatchObject({ isError: true });
  });

  it("turns write tools into proposals instead of executing them", () => {
    const out = runTool(store, "cust_5521", "issue_refund", { order_id: "A1042", amount: 249, reason_code: "damaged", kb_article_id: "kb_112", justification: "x" });
    expect(out).toMatchObject({ kind: "proposal", proposal: { action: "refund", amount: 249 } });
    expect(store.state.refunds).toHaveLength(0);
  });

  it("rejects proposals against another customer's order", () => {
    const out = runTool(store, "cust_5521", "issue_refund", { order_id: "B2001", amount: 10, reason_code: "damaged", kb_article_id: "kb_112", justification: "x" });
    expect(out).toMatchObject({ kind: "result", isError: true });
  });

  it("returns readable errors for invalid input", () => {
    expect(runTool(store, "cust_5521", "issue_refund", { order_id: "A1042", amount: -5 })).toMatchObject({ isError: true });
  });

  it("gives the FAQ path no write tools", () => {
    const names = toolsFor("faq").map((t) => t.name);
    expect(names).not.toContain("issue_refund");
    expect(names).not.toContain("get_order");
  });

  it("ranks the relevant KB article first", () => {
    expect(searchKb(store, "my item arrived damaged")[0].id).toBe("kb_112");
  });
});
