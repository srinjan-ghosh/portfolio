import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { handleMessage, resolveApproval } from "./agent.js";
import { createLLM } from "./llm.js";
import { Store } from "./store.js";
import type { TraceKind } from "./types.js";

const COLORS: Record<TraceKind, string> = { user: "37", think: "35", tool: "33", result: "36", guard: "31", human: "38;5;208", final: "32" };
const paint = (code: string, s: string) => (stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);

if (process.env.RESOLVEAI_MOCK_LLM !== "1" && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.log(paint("33", "No ANTHROPIC_API_KEY set. Run with RESOLVEAI_MOCK_LLM=1 for the offline scripted model."));
}

const store = new Store(null);
const deps = { store, llm: createLLM() };
store.onTrace((_t, e) => console.log(`  ${paint(COLORS[e.kind], `[${e.step} · ${e.label}]`)} ${e.text}`));

const rl = createInterface({ input: stdin, terminal: stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
/** Prompt and read one line. Works for both interactive use and piped input. */
async function ask(prompt: string): Promise<string> {
  stdout.write(prompt);
  const next = await lines.next();
  if (next.done) process.exit(0);
  if (!stdin.isTTY) stdout.write(next.value + "\n");
  return next.value;
}
console.log(paint("1", `\nResolveAI support agent · model: ${deps.llm.name}`));
console.log("Demo customers: " + store.state.customers.map((c) => `${c.email} (${store.ordersFor(c.id).map((o) => o.id).join(", ")})`).join(" · "));
console.log('Try: "My headphones, order A1042, arrived with a cracked headband." Type "exit" to quit.\n');

const email = (await ask("Your email [alex@example.com]: ")).trim() || "alex@example.com";

while (true) {
  const text = (await ask(paint("1", "\nYou: "))).trim();
  if (!text) continue;
  if (text === "exit") break;

  let ticket = await handleMessage(deps, { email, text });

  // Step 6 inline: act as the support lead when the policy engine asks for approval.
  while (ticket.status === "awaiting_approval") {
    const approval = store.state.approvals.find((a) => a.ticketId === ticket.id && a.status === "pending")!;
    const { card } = approval;
    console.log(paint("38;5;208", `\n  ── Approval needed (${approval.id}) ──`));
    console.log(`  Customer: ${card.customer}`);
    for (const e of card.evidence) console.log(`  • ${e}`);
    console.log(`  Proposed: ${card.proposal.action} $${card.proposal.amount.toFixed(2)} on ${card.proposal.orderId} (${card.proposal.reasonCode})`);
    console.log(`  Why: ${card.proposal.justification}`);
    console.log(`  Triggered by: ${card.rule}`);
    const answer = (await ask("  Approve? [a]pprove / [e]dit amount / [r]eject: ")).trim().toLowerCase();
    if (answer.startsWith("e")) {
      const amount = Number(await ask("  New amount: $"));
      if (!Number.isFinite(amount) || amount <= 0) {
        console.log("  Please enter a positive number.");
        continue;
      }
      ticket = await resolveApproval(deps, approval.id, { decision: "approve", reviewer: "you", amount });
    } else if (answer.startsWith("r")) {
      const note = await ask("  Note for the agent: ");
      ticket = await resolveApproval(deps, approval.id, { decision: "reject", reviewer: "you", note: note || undefined });
    } else {
      ticket = await resolveApproval(deps, approval.id, { decision: "approve", reviewer: "you" });
    }
  }
  console.log(paint("32", `\nResolveAI: ${ticket.messages.at(-1)!.text}`));
}
rl.close();
