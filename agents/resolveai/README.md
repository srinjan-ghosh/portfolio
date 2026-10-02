# ResolveAI: working implementation

A runnable version of the customer support agent described on the portfolio's
[ResolveAI project page](../../projects/support-agent.html). It handles a support ticket end to end:
it identifies the customer, classifies the issue, routes it, investigates with real tools, checks every
proposed action against a policy engine in code, pauses for human approval when required, then acts and replies.

Back-office systems (orders, shipping, refunds, knowledge base) are simulated with seed data in
`src/data/seed.ts`, so it runs anywhere.

## Quick start

Requires Node 20+.

```bash
cd agents/resolveai
npm install

# Offline: a scripted stand-in for the model, no API key needed
RESOLVEAI_MOCK_LLM=1 npm run web     # http://localhost:3000 and /approvals
RESOLVEAI_MOCK_LLM=1 npm run cli     # terminal version, you approve inline

# With Claude
export ANTHROPIC_API_KEY=sk-ant-...
npm run web
```

In the web UI, pick a demo customer, click an example message, and watch the trace. When a refund is over
$100, the run pauses. Open **Reviewer queue** to approve, edit the amount, or reject, and the chat updates
when the agent resumes.

| Env var | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Claude API key (not needed in mock mode) |
| `RESOLVEAI_MOCK_LLM` | unset | `1` uses the scripted model in `src/llm.ts` |
| `RESOLVEAI_MODEL` | `claude-opus-5-5` | Model for triage and the agent |
| `PORT` | `3000` | Web server port |
| `RESOLVEAI_STATE` | `data/state.json` | Where the web server persists tickets, paused runs and refunds |

## Demo scenarios

| Customer | Message | What happens |
| --- | --- | --- |
| alex@example.com | "My headphones, order A1042, arrived with a cracked headband." | $249 refund → **rule 4** → paused for approval → executed → reply with refund reference |
| alex@example.com | "My phone case (A1077) arrived broken." | $19 refund → within policy → executed automatically |
| alex@example.com | "I want to return my rain jacket, order A0950." | 45 days old → **rule 3 deny** → agent offers store credit |
| alex@example.com | "…and I'm calling my lawyer." | `legal` risk flag → routed straight to a human |
| alex@example.com | "Order B2001 arrived damaged" | Someone else's order → tools refuse → agent asks to confirm the order ID |
| jordan@example.com | "How do I reset my password?" | FAQ route → knowledge-base answer, no write tools available |
| jordan@example.com | "Where is my smart watch? Order B2001…" | Carrier lists it lost → refund $399 → paused for approval |
| sam@example.com | "My desk lamp C3005 arrived broken." | 3 refunds in 90 days → **rule 2** → approval even for $45 |

## How the code maps to the workflow

| Step | File | What it does |
| --- | --- | --- |
| 1 Intake & identify | `src/redact.ts`, `src/agent.ts` | Redacts card numbers, SSNs and phone numbers; looks up the customer; threads into an open ticket |
| 2 Triage | `src/llm.ts` | Structured output validated by the zod `Triage` schema in `src/types.ts` |
| 3 Route | `src/router.ts` | Deterministic: risk flags, low confidence, angry VIPs → human; FAQ intents → knowledge base only |
| 4 Investigate & propose | `src/agent.ts`, `src/tools.ts` | Tool-use loop. Read tools are scoped to the customer; `issue_refund` / `create_replacement` only create proposals |
| 5 Policy check | `src/policy.ts` | Rules 1–6 from the project page → allow / needs_approval / deny |
| 6 Human approval | `src/agent.ts` (`resolveApproval`) | Saves the run, creates an approval card, and on decision feeds it back as the tool result and resumes |
| 7 Act, reply & close | `src/execute.ts`, `src/agent.ts` (`finish`) | Idempotent execution; reply check blocks claims of actions that didn't happen |

Interfaces: `src/cli.ts` (terminal), `src/server.ts` + `web/` (chat page and reviewer queue).

### Model usage

- Triage uses `client.beta.messages.parse` with a zod output format at `effort: "low"`.
- The agent loop is a manual tool-use loop at `effort: "medium"`, so the policy check and the pause/resume can sit between the model's proposal and execution.
- Requests opt into server-side refusal fallback (`fallbacks: "default"`). If the model still declines, the ticket goes to a human.

## Tests

```bash
npm run typecheck
npm test
```

The tests run on the scripted model and cover the policy rules and their order, routing, redaction, tool
scoping, and full scenarios: approve, edit amount, reject, auto-allow, deny with alternative, risky history,
legal escalation, cross-customer access, FAQ answers, and idempotent replay.
