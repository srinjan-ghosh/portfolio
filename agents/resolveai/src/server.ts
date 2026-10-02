import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { handleMessage, resolveApproval } from "./agent.js";
import { createLLM } from "./llm.js";
import { Store } from "./store.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(ROOT, "web");
const PORT = Number(process.env.PORT ?? 3000);
const STATE_FILE = process.env.RESOLVEAI_STATE ?? join(ROOT, "data", "state.json");

const store = new Store(STATE_FILE);
const llm = createLLM();
const deps = () => ({ store, llm });

const NewTicket = z.object({ email: z.string().email(), text: z.string().min(1).max(4000) });
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

/** Agent work runs in the background; the UI polls for progress. Failures are recorded on the ticket. */
function background(ticketId: string | null, work: Promise<unknown>) {
  work.catch((err) => {
    console.error(err);
    const t = ticketId && store.ticket(ticketId);
    if (t) {
      store.trace(t, { kind: "guard", label: "error", text: String(err?.message ?? err), step: "r4" });
      t.status = "escalated";
      store.save();
    }
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  try {
    if (path === "/api/customers" && req.method === "GET") {
      return send(res, 200, store.state.customers.map((c) => ({ ...c, orders: store.ordersFor(c.id) })));
    }
    if (path === "/api/tickets" && req.method === "POST") {
      const input = NewTicket.parse(await body(req));
      // The ticket is created synchronously at intake; the rest of the workflow continues in the background.
      let ticketId: string | null = null;
      const work = handleMessage(deps(), input, (t) => (ticketId = t.id));
      background(ticketId, work);
      return send(res, 202, { ticketId });
    }
    const ticketMatch = path.match(/^\/api\/tickets\/([\w-]+)$/);
    if (ticketMatch && req.method === "GET") {
      const t = store.ticket(ticketMatch[1]);
      return t ? send(res, 200, t) : send(res, 404, { error: "not found" });
    }
    if (path === "/api/approvals" && req.method === "GET") {
      return send(res, 200, store.state.approvals.slice().reverse());
    }
    const apprMatch = path.match(/^\/api\/approvals\/([\w-]+)$/);
    if (apprMatch && req.method === "POST") {
      const approval = store.approval(apprMatch[1]);
      if (!approval) return send(res, 404, { error: "not found" });
      if (approval.status !== "pending") return send(res, 409, { error: `already ${approval.status}` });
      const review = await body(req);
      background(approval.ticketId, resolveApproval(deps(), approval.id, review));
      return send(res, 202, { ok: true });
    }
    if (path === "/api/reset" && req.method === "POST") {
      store.reset();
      return send(res, 200, { ok: true });
    }

    // Static files
    const file = path === "/" ? "index.html" : path === "/approvals" ? "approvals.html" : path.slice(1);
    const full = normalize(join(WEB, file));
    if (!full.startsWith(WEB)) return send(res, 403, { error: "forbidden" });
    const data = await readFile(full).catch(() => null);
    if (!data) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": TYPES[extname(full)] ?? "application/octet-stream" });
    res.end(data);
  } catch (err) {
    if (err instanceof z.ZodError || err instanceof SyntaxError) return send(res, 400, { error: err.message });
    console.error(err);
    send(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, () => {
  console.log(`ResolveAI · model: ${llm.name}`);
  console.log(`  Customer chat:  http://localhost:${PORT}/`);
  console.log(`  Reviewer queue: http://localhost:${PORT}/approvals`);
  if (llm.name !== "mock" && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("  Warning: no ANTHROPIC_API_KEY set. Use RESOLVEAI_MOCK_LLM=1 for the offline scripted model.");
  }
});
