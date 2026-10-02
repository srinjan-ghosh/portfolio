import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { seed, type SeedData } from "./data/seed.js";
import type { Approval, RefundRecord, ReplacementRecord, Run, Ticket, TraceEvent } from "./types.js";

interface State extends SeedData {
  tickets: Ticket[];
  runs: Run[];
  approvals: Approval[];
  refunds: RefundRecord[];
  replacements: ReplacementRecord[];
  counter: number;
}

/**
 * Single source of truth for back-office data and agent state.
 * Persisted to a JSON file when `file` is given, so paused runs survive a restart.
 */
export class Store {
  state: State;
  private listeners: ((ticket: Ticket, event: TraceEvent) => void)[] = [];

  constructor(private file: string | null = null, now = new Date()) {
    this.state = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : Store.fresh(now);
  }

  private static fresh(now: Date): State {
    return { ...seed(now), tickets: [], runs: [], approvals: [], refunds: [], replacements: [], counter: 1000 };
  }

  /** Back to the seed data (demo reset). */
  reset() {
    this.state = Store.fresh(new Date());
    this.save();
  }

  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  nextId(prefix: string) {
    return `${prefix}_${++this.state.counter}`;
  }

  // ---------- Lookups ----------
  customerByEmail(email: string) {
    return this.state.customers.find((c) => c.email.toLowerCase() === email.trim().toLowerCase());
  }
  customer(id: string) {
    return this.state.customers.find((c) => c.id === id);
  }
  order(id: string) {
    return this.state.orders.find((o) => o.id.toUpperCase() === id.trim().toUpperCase());
  }
  ordersFor(customerId: string) {
    return this.state.orders.filter((o) => o.customerId === customerId);
  }
  shipment(orderId: string) {
    return this.state.shipments.find((s) => s.orderId === orderId);
  }
  ticket(id: string) {
    return this.state.tickets.find((t) => t.id === id);
  }
  run(id: string) {
    return this.state.runs.find((r) => r.id === id);
  }
  approval(id: string) {
    return this.state.approvals.find((a) => a.id === id);
  }
  refundsInLast90Days(customerId: string) {
    const orderIds = new Set(this.ordersFor(customerId).map((o) => o.id));
    const cutoff = Date.now() - 90 * 86_400_000;
    const recent = this.state.refunds.filter((r) => orderIds.has(r.orderId) && Date.parse(r.at) >= cutoff).length;
    return recent + (this.customer(customerId)?.priorRefunds90d ?? 0);
  }

  // ---------- Trace ----------
  onTrace(listener: (ticket: Ticket, event: TraceEvent) => void) {
    this.listeners.push(listener);
  }
  trace(ticket: Ticket, event: Omit<TraceEvent, "at">) {
    const full = { ...event, at: new Date().toISOString() };
    ticket.trace.push(full);
    for (const l of this.listeners) l(ticket, full);
  }
}
