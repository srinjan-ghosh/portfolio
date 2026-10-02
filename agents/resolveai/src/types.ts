import { z } from "zod";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

// ---------- Back-office records ----------

export interface Customer {
  id: string;
  email: string;
  name: string;
  tier: "standard" | "vip";
  fraudSignal: boolean;
  /** Refunds issued before this system started (seed history). */
  priorRefunds90d: number;
}

export interface Order {
  id: string;
  customerId: string;
  item: string;
  total: number;
  refunded: number;
  placedAt: string;
  deliveredAt: string | null;
  status: "processing" | "shipped" | "delivered";
}

export interface Shipment {
  orderId: string;
  carrier: string;
  events: { at: string; description: string }[];
  note?: string;
}

export interface KbArticle {
  id: string;
  title: string;
  body: string;
  keywords: string[];
}

// ---------- Step 2: triage ----------

export const Intent = z.enum([
  "order_status",
  "damaged_item",
  "wrong_item",
  "return_request",
  "refund_status",
  "billing",
  "product_question",
  "account",
  "other",
]);

export const Triage = z.object({
  intent: Intent,
  entities: z.object({
    order_ids: z.array(z.string()),
    products: z.array(z.string()),
  }),
  urgency: z.enum(["low", "normal", "high"]),
  sentiment: z.enum(["positive", "neutral", "frustrated", "angry"]),
  risk_flags: z.array(z.enum(["legal", "chargeback", "safety", "fraud_signal"])),
  confidence: z.number().min(0).max(1),
});
export type Triage = z.infer<typeof Triage>;

export type Route = "faq" | "order_agent" | "human";

// ---------- Step 4/5: proposals & policy ----------

export const ReasonCode = z.enum(["damaged", "not_received", "wrong_item", "late", "return", "goodwill"]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const RefundInput = z.object({
  order_id: z.string(),
  amount: z.number().positive(),
  reason_code: ReasonCode,
  kb_article_id: z.string(),
  justification: z.string(),
});

export const ReplacementInput = z.object({
  order_id: z.string(),
  reason_code: ReasonCode,
  kb_article_id: z.string(),
  justification: z.string(),
});

export interface Proposal {
  action: "refund" | "replacement";
  orderId: string;
  /** Refund amount, or item value for a replacement. */
  amount: number;
  reasonCode: ReasonCode;
  kbArticleId: string;
  justification: string;
}

export type Decision =
  | { outcome: "allow"; rule: number }
  | { outcome: "needs_approval"; rule: number; reasons: string[] }
  | { outcome: "deny"; rule: number; reasons: string[]; alternative?: string };

// ---------- Runtime state ----------

export type TraceKind = "user" | "think" | "tool" | "result" | "guard" | "human" | "final";

export interface TraceEvent {
  kind: TraceKind;
  label: string;
  text: string;
  /** Workflow step id, matching the portfolio diagram (r1..r7). */
  step: string;
  at: string;
}

export type TicketStatus = "open" | "working" | "awaiting_approval" | "escalated" | "resolved";

export interface Ticket {
  id: string;
  email: string;
  customerId: string | null;
  channel: "chat" | "email";
  status: TicketStatus;
  messages: { from: "customer" | "agent"; text: string; at: string }[];
  triage?: Triage;
  route?: Route;
  resolution?: string;
  trace: TraceEvent[];
}

export interface PendingToolUse {
  toolUseId: string;
  proposal: Proposal;
}

export interface Run {
  id: string;
  ticketId: string;
  mode: "faq" | "order";
  messages: BetaMessageParam[];
  turns: number;
  state: "running" | "awaiting_approval" | "done";
  /** Tool results already computed in the paused batch, returned together on resume. */
  bufferedResults: { tool_use_id: string; content: string; is_error?: boolean }[];
  pending?: PendingToolUse;
  executedActions: string[];
}

export interface ApprovalCard {
  customer: string;
  issue: string;
  evidence: string[];
  proposal: Proposal;
  rule: string;
}

export interface Approval {
  id: string;
  runId: string;
  ticketId: string;
  status: "pending" | "approved" | "rejected";
  card: ApprovalCard;
  createdAt: string;
  review?: Review;
}

export const Review = z.object({
  decision: z.enum(["approve", "reject"]),
  reviewer: z.string().min(1),
  amount: z.number().positive().optional(),
  note: z.string().optional(),
});
export type Review = z.infer<typeof Review>;

export interface RefundRecord {
  id: string;
  idempotencyKey: string;
  orderId: string;
  amount: number;
  reasonCode: ReasonCode;
  at: string;
}

export interface ReplacementRecord {
  id: string;
  idempotencyKey: string;
  orderId: string;
  item: string;
  at: string;
}
