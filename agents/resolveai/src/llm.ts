import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTool,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Triage, type Customer } from "./types.js";

export interface AgentTurn {
  content: BetaContentBlockParam[];
  stopReason: "end_turn" | "tool_use" | "refusal" | "max_tokens" | "other";
}

export interface LLM {
  readonly name: string;
  triage(message: string, customer: Customer): Promise<Triage>;
  agentTurn(req: { system: string; messages: BetaMessageParam[]; tools: BetaTool[] }): Promise<AgentTurn>;
}

const TRIAGE_SYSTEM = `You classify customer-support messages for an online store.
Return the intent, any order IDs (format like A1042) and product names mentioned, urgency, sentiment,
and risk flags: "legal" (lawyers, suing), "chargeback" (disputing with the bank), "safety" (injury, fire, hazard),
"fraud_signal" (signs the request may be fraudulent). Set confidence below 0.7 if the intent is unclear.
Use "product_question" for pre-sales or how-to questions and "account" for login/password issues.`;

// ---------------------------------------------------------------------------
// Real Claude client
// ---------------------------------------------------------------------------

export class AnthropicLLM implements LLM {
  readonly name: string;
  private client = new Anthropic();

  constructor(private model = process.env.RESOLVEAI_MODEL ?? "claude-opus-5-5") {
    this.name = model;
  }

  async triage(message: string, customer: Customer): Promise<Triage> {
    // Structured outputs instead of a forced tool call (forced tool_choice isn't supported on current models).
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 2048,
      system: TRIAGE_SYSTEM,
      output_config: { effort: "low", format: betaZodOutputFormat(Triage) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: `Customer tier: ${customer.tier}\n\nMessage:\n${message}` }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) {
      // Can't classify safely: low confidence routes the ticket to a human.
      return { intent: "other", entities: { order_ids: [], products: [] }, urgency: "normal", sentiment: "neutral", risk_flags: [], confidence: 0 };
    }
    return res.parsed_output;
  }

  async agentTurn({ system, messages, tools }: { system: string; messages: BetaMessageParam[]; tools: BetaTool[] }): Promise<AgentTurn> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      system,
      tools,
      messages,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    const stop = res.stop_reason;
    return {
      content: res.content as BetaContentBlockParam[],
      stopReason: stop === "end_turn" || stop === "tool_use" || stop === "refusal" || stop === "max_tokens" ? stop : "other",
    };
  }
}

// ---------------------------------------------------------------------------
// Scripted mock: deterministic stand-in so the demo and tests run without an API key.
// It follows the same investigate -> propose -> reply pattern the system prompt asks for.
// ---------------------------------------------------------------------------

export class MockLLM implements LLM {
  readonly name = "mock";
  private ids = 0;

  async triage(message: string): Promise<Triage> {
    const m = message.toLowerCase();
    const order_ids = [...new Set(message.toUpperCase().match(/\b[A-Z]\d{4}\b/g) ?? [])];
    const has = (...words: string[]) => words.some((w) => m.includes(w));

    let intent: Triage["intent"] = "other";
    if (has("damaged", "broken", "cracked", "smashed", "dented")) intent = "damaged_item";
    else if (has("wrong item", "wrong size", "wrong colour", "wrong color", "not what i ordered")) intent = "wrong_item";
    else if (has("return", "send it back", "send back")) intent = "return_request";
    else if (has("where is", "hasn't arrived", "has not arrived", "not received", "never arrived", "lost", "tracking")) intent = "order_status";
    else if (has("password", "log in", "login", "sign in", "account")) intent = "account";
    else if (has("how long", "shipping", "do you", "can i", "does it")) intent = "product_question";

    const risk_flags: Triage["risk_flags"] = [];
    if (has("lawyer", "sue", "legal action", "court")) risk_flags.push("legal");
    if (has("chargeback", "dispute with my bank", "dispute the charge")) risk_flags.push("chargeback");
    if (has("fire", "injur", "burn", "shock")) risk_flags.push("safety");

    const angry = has("ridiculous", "unacceptable", "furious", "worst") || /!{2,}/.test(message);
    const frustrated = has("frustrat", "disappoint", "annoy", "upset");
    return {
      intent,
      entities: { order_ids, products: [] },
      urgency: angry ? "high" : "normal",
      sentiment: angry ? "angry" : frustrated || intent === "damaged_item" ? "frustrated" : "neutral",
      risk_flags,
      confidence: intent === "other" ? 0.4 : 0.92,
    };
  }

  async agentTurn({ messages, tools }: { system: string; messages: BetaMessageParam[]; tools: BetaTool[] }): Promise<AgentTurn> {
    const calls = toolCalls(messages);
    const results = toolResults(messages);
    const last = (name: string) => {
      const call = [...calls].reverse().find((c) => c.name === name);
      return call ? results.get(call.id) : undefined;
    };
    const intro = firstUserText(messages);
    const ctx = parseContext(intro);
    const faq = !tools.some((t) => t.name === "get_order");

    const use = (name: string, input: Record<string, unknown>, say?: string): AgentTurn => ({
      stopReason: "tool_use",
      content: [
        ...(say ? [{ type: "text" as const, text: say }] : []),
        { type: "tool_use" as const, id: `toolu_mock_${++this.ids}`, name, input },
      ],
    });
    const reply = (text: string): AgentTurn => ({ stopReason: "end_turn", content: [{ type: "text", text }] });

    // ---- FAQ path: knowledge base only ----
    if (faq) {
      const kb = last("search_kb");
      if (!kb) return use("search_kb", { query: ctx.message });
      const top = kb[0];
      return reply(top ? `${top.body} (Help article: "${top.title}")\n\nAnything else I can help with?` : "I couldn't find an answer to that in our help center, so I've passed your question to a teammate.");
    }

    // ---- Order path ----
    let orderId: string | undefined = ctx.orderIds[0];
    if (!orderId) {
      const list = last("list_orders");
      if (!list) return use("list_orders", {}, "No order ID given; checking recent orders.");
      orderId = list[0]?.id;
      if (!orderId) return reply("I couldn't find any orders on your account. Could you share the order number from your confirmation email?");
    }

    const order = last("get_order");
    if (!order) return use("get_order", { order_id: orderId });
    if (order.error) return reply(`I couldn't find order ${orderId} on your account. Could you double-check the order number from your confirmation email?`);

    const tracking = last("track_shipment");
    if (!tracking) return use("track_shipment", { order_id: order.id });

    const query = { damaged_item: "damaged in transit refund", wrong_item: "wrong item", order_status: "lost not received tracking", return_request: "return refund 30 days" }[ctx.intent as string] ?? ctx.message;
    const kb = last("search_kb");
    if (!kb) return use("search_kb", { query });
    const article = kb[0]?.id ?? "kb_120";

    // ---- Outcome of a proposal ----
    const proposal = last("issue_refund");
    if (proposal) {
      if (proposal.status === "executed") {
        return reply(`I'm sorry about the trouble with your ${order.item}. I've refunded $${proposal.amount.toFixed(2)} to your original payment method (reference ${proposal.reference}). It should appear within 3-5 business days. No need to send anything back.`);
      }
      if (proposal.status === "denied") {
        const credit = proposal.alternative === "store_credit";
        return reply(`Thanks for reaching out about your ${order.item}. Because it was delivered more than 30 days ago, it's outside our refund window${credit ? ", but I can offer you store credit for the full amount instead. Just reply \"yes\" and I'll set that up" : ""}.`);
      }
      if (proposal.status === "rejected") {
        return reply(`I've reviewed your request for the ${order.item} with my team. We're not able to issue a refund this time${proposal.note ? `: ${proposal.note}` : "."} If you have more details, reply here and we'll take another look.`);
      }
    }

    const refundable = order.refundable as number;
    const deliveredDays = order.deliveredAt ? (Date.now() - Date.parse(order.deliveredAt)) / 86_400_000 : null;
    const carrierNote: string = tracking.note ?? "";

    if (ctx.intent === "damaged_item" || ctx.intent === "wrong_item") {
      return use("issue_refund", {
        order_id: order.id,
        amount: refundable,
        reason_code: ctx.intent === "damaged_item" ? "damaged" : "wrong_item",
        kb_article_id: article,
        justification: `${ctx.intent === "damaged_item" ? "Item arrived damaged" : "Wrong item sent"}${carrierNote ? `; carrier note: ${carrierNote}` : ""}. Full refund per ${article}.`,
      }, "Issue confirmed; proposing a refund per policy.");
    }
    if (ctx.intent === "return_request") {
      return use("issue_refund", {
        order_id: order.id,
        amount: refundable,
        reason_code: "return",
        kb_article_id: article,
        justification: `Customer wants to return an unused item delivered ${deliveredDays?.toFixed(0)} days ago.`,
      });
    }
    if (ctx.intent === "order_status") {
      if (/lost/i.test(carrierNote)) {
        return use("issue_refund", { order_id: order.id, amount: refundable, reason_code: "not_received", kb_article_id: article, justification: `Carrier lists the package as lost: ${carrierNote}` });
      }
      const lastEvent = tracking.events?.at(-1)?.description ?? "in transit";
      return reply(`Your ${order.item} (order ${order.id}) shows: "${lastEvent}". Let me know if anything looks wrong.`);
    }
    return use("escalate_to_human", { summary: `Couldn't determine how to help with order ${order.id}.` });
  }
}

// ---------- Helpers for reading the transcript ----------

function blocks(m: BetaMessageParam): BetaContentBlockParam[] {
  return typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
}

function firstUserText(messages: BetaMessageParam[]) {
  const b = blocks(messages[0]).find((x) => x.type === "text");
  return b && "text" in b ? b.text : "";
}

function toolCalls(messages: BetaMessageParam[]) {
  return messages
    .filter((m) => m.role === "assistant")
    .flatMap(blocks)
    .filter((b): b is Extract<BetaContentBlockParam, { type: "tool_use" }> => b.type === "tool_use");
}

function toolResults(messages: BetaMessageParam[]) {
  const map = new Map<string, any>();
  for (const b of messages.filter((m) => m.role === "user").flatMap(blocks)) {
    if (b.type === "tool_result" && typeof b.content === "string") {
      try {
        map.set(b.tool_use_id, JSON.parse(b.content));
      } catch {
        map.set(b.tool_use_id, { text: b.content });
      }
    }
  }
  return map;
}

/** The agent's first message embeds a JSON context block; the mock reads it back. */
function parseContext(text: string): { intent: string; orderIds: string[]; message: string } {
  const m = text.match(/<context>([\s\S]*?)<\/context>/);
  const ctx = m ? JSON.parse(m[1]) : {};
  return { intent: ctx.triage?.intent ?? "other", orderIds: ctx.triage?.entities?.order_ids ?? [], message: ctx.message ?? text };
}

export function createLLM(): LLM {
  if (process.env.RESOLVEAI_MOCK_LLM === "1") return new MockLLM();
  return new AnthropicLLM();
}
