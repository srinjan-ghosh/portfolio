import type { Customer, KbArticle, Order, Shipment } from "../types.js";

const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * 86_400_000).toISOString();

/** Demo back-office data. Dates are relative to `now` so the 30-day policy behaves the same on every run. */
export function seed(now = new Date()) {
  const customers: Customer[] = [
    { id: "cust_5521", email: "alex@example.com", name: "Alex Rivera", tier: "standard", fraudSignal: false, priorRefunds90d: 0 },
    { id: "cust_7710", email: "jordan@example.com", name: "Jordan Lee", tier: "vip", fraudSignal: false, priorRefunds90d: 0 },
    { id: "cust_3003", email: "sam@example.com", name: "Sam Patel", tier: "standard", fraudSignal: false, priorRefunds90d: 3 },
  ];

  const orders: Order[] = [
    { id: "A1042", customerId: "cust_5521", item: "Wireless Headphones", total: 249, refunded: 0, placedAt: daysAgo(6, now), deliveredAt: daysAgo(2, now), status: "delivered" },
    { id: "A1077", customerId: "cust_5521", item: "Phone Case", total: 19, refunded: 0, placedAt: daysAgo(5, now), deliveredAt: daysAgo(3, now), status: "delivered" },
    { id: "A0950", customerId: "cust_5521", item: "Rain Jacket", total: 120, refunded: 0, placedAt: daysAgo(50, now), deliveredAt: daysAgo(45, now), status: "delivered" },
    { id: "B2001", customerId: "cust_7710", item: "Smart Watch", total: 399, refunded: 0, placedAt: daysAgo(12, now), deliveredAt: null, status: "shipped" },
    { id: "C3005", customerId: "cust_3003", item: "Desk Lamp", total: 45, refunded: 0, placedAt: daysAgo(8, now), deliveredAt: daysAgo(4, now), status: "delivered" },
  ];

  const shipments: Shipment[] = [
    { orderId: "A1042", carrier: "UPS", events: [{ at: daysAgo(5, now), description: "Shipped" }, { at: daysAgo(2, now), description: "Delivered, signed by customer" }], note: "Package damaged in transit (carrier exception logged)" },
    { orderId: "A1077", carrier: "USPS", events: [{ at: daysAgo(4, now), description: "Shipped" }, { at: daysAgo(3, now), description: "Delivered to mailbox" }], note: "Package damaged in transit (carrier exception logged)" },
    { orderId: "A0950", carrier: "UPS", events: [{ at: daysAgo(48, now), description: "Shipped" }, { at: daysAgo(45, now), description: "Delivered, left at front door" }] },
    { orderId: "B2001", carrier: "FedEx", events: [{ at: daysAgo(11, now), description: "Shipped" }, { at: daysAgo(10, now), description: "In transit, departed regional hub" }], note: "No scan for 10 days; carrier lists package as lost" },
    { orderId: "C3005", carrier: "USPS", events: [{ at: daysAgo(6, now), description: "Shipped" }, { at: daysAgo(4, now), description: "Delivered to mailbox" }], note: "Package damaged in transit (carrier exception logged)" },
  ];

  const kb: KbArticle[] = [
    { id: "kb_112", title: "Items damaged in transit", body: "If an item arrives damaged, the customer is entitled to a full refund or a free replacement within 30 days of delivery. No return is required for items under $300.", keywords: ["damaged", "broken", "cracked", "transit", "arrived", "refund", "replacement"] },
    { id: "kb_115", title: "Wrong item received", body: "If we sent the wrong item, we ship the correct item free and send a prepaid return label, or refund in full.", keywords: ["wrong", "incorrect", "different", "item"] },
    { id: "kb_118", title: "Orders not received or lost", body: "If tracking shows no movement for 7+ days or the carrier marks the package lost, we refund in full or reship.", keywords: ["lost", "not received", "missing", "never arrived", "where", "tracking", "late"] },
    { id: "kb_120", title: "Returns policy", body: "Unused items can be returned for a refund within 30 days of delivery. After 30 days we can offer store credit instead.", keywords: ["return", "returns", "refund", "unused", "30 days", "change of mind"] },
    { id: "kb_130", title: "Store credit", body: "Store credit is issued as a gift card to the customer's account and never expires.", keywords: ["store credit", "gift card", "credit"] },
    { id: "kb_201", title: "Shipping times", body: "Standard shipping takes 3-5 business days. Express takes 1-2 business days.", keywords: ["shipping", "delivery time", "how long", "express"] },
    { id: "kb_210", title: "Resetting your password", body: "Use 'Forgot password' on the sign-in page. The reset link is valid for 1 hour.", keywords: ["password", "login", "sign in", "account", "reset"] },
  ];

  return { customers, orders, shipments, kb };
}

export type SeedData = ReturnType<typeof seed>;
