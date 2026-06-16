import { serve } from "bun";
import index from "./index.html";
import { createEmailAgent, buildClassifyPrompt } from "./Agents/EmailAgent";
import type { AgentStreamEvent } from "@strands-agents/sdk";
import { fetchInboxEmails, fetchEmailPage, deleteEmailsByUid, deleteByFrom, deleteByCategory } from "./lib/imap";

const PAGE_SIZE = 100;
const BATCH_SIZE = 50;

function parseEmailResults(text: string): Array<{ uid: number; from: string; recommendation: "keep" | "delete" }> {
  const results: Array<{ uid: number; from: string; recommendation: "keep" | "delete" }> = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start === -1) break;
    let depth = 0;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end !== -1) {
      try {
        const obj = JSON.parse(text.slice(start, end + 1));
        if (obj.uid && obj.recommendation) results.push(obj);
      } catch {}
      i = end + 1;
    } else break;
  }
  return results;
}

async function classifyBatch(emails: Parameters<typeof import("./Agents/EmailAgent")["buildClassifyPrompt"]>[0]) {
  if (emails.length === 0) return [];
  const { createEmailAgent, buildClassifyPrompt } = await import("./Agents/EmailAgent");
  let text = "";
  for await (const event of createEmailAgent().stream(buildClassifyPrompt(emails)) as AsyncGenerator<AgentStreamEvent>) {
    if (event.type === "modelStreamUpdateEvent") {
      const inner = event.event;
      if (inner.type === "modelContentBlockDeltaEvent" && inner.delta.type === "textDelta") {
        text += inner.delta.text;
      }
    }
  }
  return parseEmailResults(text);
}

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,
    "/api/email/scan": {
      async POST() {
        const { emails } = await fetchInboxEmails(50);
        const prompt = buildClassifyPrompt(emails);
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            const send = (data: object) => {
              try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
            };

            void (async () => {
              try {
                for await (const event of createEmailAgent().stream(prompt) as AsyncGenerator<AgentStreamEvent>) {
                  if (event.type === "modelStreamUpdateEvent") {
                    const inner = event.event;
                    if (inner.type === "modelContentBlockDeltaEvent" && inner.delta.type === "textDelta") {
                      send({ chunk: inner.delta.text });
                    }
                  }
                }
                send({ done: true });
              } catch (err) {
                send({ error: String(err) });
              } finally {
                try { controller.close(); } catch {}
              }
            })();
          },
        });
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      },
    },

    "/api/email/delete": {
      async POST(req) {
        const { uids } = await req.json();
        const deleted = await deleteEmailsByUid(uids);
        return Response.json({ deleted });
      },
    },

    "/api/email/delete/sender": {
      async POST(req) {
        const { from } = await req.json();
        const deleted = await deleteByFrom(from);
        return Response.json({ deleted });
      },
    },

    "/api/email/auto-clean/preview": {
      async POST() {
        const PREVIEW_LIMIT = 200;
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            const send = (data: object) => {
              try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
            };

            void (async () => {
              const heartbeat = setInterval(() => {
                try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch {}
              }, 8000);

              try {
                const { emails, total } = await fetchInboxEmails(PREVIEW_LIMIT);
                send({ init: { total } });

                // Sequential batches — each sends progress so the connection stays active
                const allResults = [];
                for (let i = 0; i < emails.length; i += 50) {
                  const batch = await classifyBatch(emails.slice(i, i + 50));
                  allResults.push(...batch);
                  send({ progress: { scanned: allResults.length } });
                }

                // Build sender groups (subject lookup from original email data)
                const uidToSubject = new Map(emails.map(e => [e.uid, e.subject]));
                const senderMap = new Map<string, { recommendation: "keep" | "delete"; subjects: string[] }>();

                for (const r of allResults) {
                  if (!senderMap.has(r.from)) {
                    senderMap.set(r.from, { recommendation: r.recommendation, subjects: [] });
                  }
                  const entry = senderMap.get(r.from)!;
                  if (r.recommendation === "keep") entry.recommendation = "keep";
                  const subject = uidToSubject.get(r.uid);
                  if (subject && entry.subjects.length < 2) entry.subjects.push(subject);
                }

                const toDelete: Array<{ from: string; subjects: string[] }> = [];
                const toKeep: Array<{ from: string; subjects: string[] }> = [];
                for (const [from, entry] of senderMap) {
                  (entry.recommendation === "delete" ? toDelete : toKeep).push({ from, subjects: entry.subjects });
                }

                send({ done: true, preview: { toDelete, toKeep, scanned: emails.length, total } });
              } catch (err) {
                send({ error: String(err) });
              } finally {
                clearInterval(heartbeat);
                try { controller.close(); } catch {}
              }
            })();
          },
        });

        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      },
    },

    "/api/email/auto-clean": {
      async POST(req) {
        const { knownDecisions = {} } = (await req.json().catch(() => ({}))) as {
          knownDecisions?: Record<string, "keep" | "delete">;
        };
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            const send = (data: object) => {
              try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
            };

            void (async () => {
              const heartbeat = setInterval(() => {
                try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch {}
              }, 8000);

              try {
                const { total } = await fetchInboxEmails(1);
                let analyzed = 0;

                // sender -> "delete" | "keep" — "keep" is sticky once set
                const senderDecisions = new Map<string, "delete" | "keep">(
                  Object.entries(knownDecisions)
                );
                const overriddenSenders = new Set(Object.keys(knownDecisions));

                for (let pageStart = 1; pageStart <= total; pageStart += PAGE_SIZE) {
                  const pageEnd = Math.min(pageStart + PAGE_SIZE - 1, total);
                  const { emails } = await fetchEmailPage(pageStart, pageEnd);
                  if (emails.length === 0) continue;

                  const [r1, r2] = await Promise.all([
                    classifyBatch(emails.slice(0, BATCH_SIZE)),
                    classifyBatch(emails.slice(BATCH_SIZE)),
                  ]);

                  for (const r of [...r1, ...r2]) {
                    if (overriddenSenders.has(r.from)) continue;
                    if (senderDecisions.get(r.from) !== "keep") {
                      senderDecisions.set(r.from, r.recommendation);
                    }
                  }

                  analyzed += emails.length;
                  send({ progress: { analyzed, total, deleted: 0 } });
                }

                // Delete all confirmed-delete senders sequentially (avoids IMAP connection overload)
                let deleted = 0;
                for (const [sender, decision] of senderDecisions) {
                  if (decision === "delete") {
                    deleted += await deleteByFrom(sender);
                  }
                }

                send({ done: true, summary: { analyzed, deleted } });
              } catch (err) {
                send({ error: String(err) });
              } finally {
                clearInterval(heartbeat);
                try { controller.close(); } catch {}
              }
            })();
          },
        });

        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      },
    },

    "/api/email/delete/category": {
      async POST(req) {
        const { category, localUids } = await req.json();
        const deleted = await deleteByCategory(category, localUids);
        return Response.json({ deleted });
      },
    },

  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
