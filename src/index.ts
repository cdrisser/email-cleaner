import { serve } from "bun";
import index from "./index.html";
import { createEmailAgent, buildClassifyPrompt } from "./Agents/EmailAgent";
import type { AgentStreamEvent } from "@strands-agents/sdk";
import { ModelThrottledError } from "@strands-agents/sdk";
import {
  fetchInboxEmails,
  fetchEmailsForClean,
  deleteEmailsByUid,
  deleteByFrom,
  deleteByCategory,
  fetchUnsubscribeHeaders,
} from "./lib/imap";
import { buildUnsubscribeEntry, batchUnsubscribe, type UnsubscribeEntry } from "./lib/unsubscribe";

const PAGE_SIZE = 100;
const AGENTS_PER_PAGE = 4;

function parseEmailResults(
  text: string
): Array<{ uid: number; from: string; recommendation: "keep" | "delete" }> {
  const results: Array<{ uid: number; from: string; recommendation: "keep" | "delete" }> = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start === -1) break;
    let depth = 0;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
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

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const extra = (err as unknown as Record<string, unknown>).responseText;
    return extra ? `${err.message}: ${extra}` : err.message;
  }
  return String(err);
}

async function classifyBatch(
  emails: Parameters<(typeof import("./Agents/EmailAgent"))["buildClassifyPrompt"]>[0]
) {
  if (emails.length === 0) return [];
  const { createEmailAgent, buildClassifyPrompt } = await import("./Agents/EmailAgent");
  let delay = 2000;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      let text = "";
      for await (const event of createEmailAgent().stream(
        buildClassifyPrompt(emails)
      ) as AsyncGenerator<AgentStreamEvent>) {
        if (event.type === "modelStreamUpdateEvent") {
          const inner = event.event;
          if (inner.type === "modelContentBlockDeltaEvent" && inner.delta.type === "textDelta") {
            text += inner.delta.text;
          }
        }
      }
      return parseEmailResults(text);
    } catch (err) {
      if (err instanceof ModelThrottledError && attempt < 4) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
  return [];
}

const server = serve({
  routes: {
    "/*": index,
    "/api/email/scan": {
      async POST() {
        const { emails } = await fetchInboxEmails(50);
        const prompt = buildClassifyPrompt(emails);
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            const send = (data: object) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              } catch {}
            };

            void (async () => {
              try {
                for await (const event of createEmailAgent().stream(
                  prompt
                ) as AsyncGenerator<AgentStreamEvent>) {
                  if (event.type === "modelStreamUpdateEvent") {
                    const inner = event.event;
                    if (
                      inner.type === "modelContentBlockDeltaEvent" &&
                      inner.delta.type === "textDelta"
                    ) {
                      send({ chunk: inner.delta.text });
                    }
                  }
                }
                send({ done: true });
              } catch (err) {
                send({ error: formatError(err) });
              } finally {
                try {
                  controller.close();
                } catch {}
              }
            })();
          },
        });
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
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
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              } catch {}
            };

            void (async () => {
              const heartbeat = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(": keepalive\n\n"));
                } catch {}
              }, 8000);

              try {
                const { emails, total } = await fetchInboxEmails(PREVIEW_LIMIT);
                send({ init: { total } });

                // Stream per-email progress by tapping the AI text stream directly
                const allResults = [];
                for (let i = 0; i < emails.length; i += 50) {
                  const batch = emails.slice(i, i + 50);
                  let text = "";
                  let lastCount = 0;
                  for await (const event of createEmailAgent().stream(buildClassifyPrompt(batch)) as AsyncGenerator<AgentStreamEvent>) {
                    if (event.type === "modelStreamUpdateEvent") {
                      const inner = event.event;
                      if (inner.type === "modelContentBlockDeltaEvent" && inner.delta.type === "textDelta") {
                        text += inner.delta.text;
                        const partial = parseEmailResults(text);
                        if (partial.length > lastCount) {
                          lastCount = partial.length;
                          send({ progress: { scanned: allResults.length + lastCount, currentSubject: batch[lastCount]?.subject } });
                        }
                      }
                    }
                  }
                  allResults.push(...parseEmailResults(text));
                }
                send({ progress: { scanned: allResults.length } });

                // Build sender groups (subject lookup from original email data)
                const uidToSubject = new Map(emails.map((e) => [e.uid, e.subject]));
                const senderMap = new Map<
                  string,
                  { recommendation: "keep" | "delete"; subjects: string[] }
                >();

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
                  (entry.recommendation === "delete" ? toDelete : toKeep).push({
                    from,
                    subjects: entry.subjects,
                  });
                }

                send({ done: true, preview: { toDelete, toKeep, scanned: emails.length, total } });
              } catch (err) {
                send({ error: formatError(err) });
              } finally {
                clearInterval(heartbeat);
                try {
                  controller.close();
                } catch {}
              }
            })();
          },
        });

        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },

    "/api/email/auto-clean": {
      async POST(req) {
        const { knownDecisions = {}, cursor } = (await req.json().catch(() => ({}))) as {
          knownDecisions?: Record<string, "keep" | "delete">;
          cursor?: number;
        };
        const encoder = new TextEncoder();
        const abort = new AbortController();
        const { signal } = abort;
        const body = new ReadableStream({
          start(controller) {
            const send = (data: object) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              } catch {}
            };

            void (async () => {
              const heartbeat = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(": keepalive\n\n"));
                } catch {}
              }, 8000);

              try {
                const { emails, minUid } = await fetchEmailsForClean(PAGE_SIZE, cursor);
                const cleanTotal = emails.length;

                if (cleanTotal === 0) {
                  send({ done: true, summary: { analyzed: 0, deleted: 0, minUid: null } });
                  return;
                }

                const senderDecisions = new Map<string, "delete" | "keep">(
                  Object.entries(knownDecisions)
                );
                const overriddenSenders = new Set(Object.keys(knownDecisions));

                // Classify in parallel sub-batches, streaming progress after each
                const batchSize = Math.ceil(emails.length / AGENTS_PER_PAGE);
                const slices = Array.from({ length: AGENTS_PER_PAGE }, (_, k) =>
                  emails.slice(k * batchSize, (k + 1) * batchSize)
                ).filter((s) => s.length > 0);

                let analyzed = 0;
                const allResults: Array<{ uid: number; from: string; recommendation: "keep" | "delete" }> = [];
                for (const results of await Promise.all(slices.map(async (slice) => {
                  const r = await classifyBatch(slice);
                  analyzed += slice.length;
                  send({ progress: { analyzed, total: cleanTotal } });
                  return r;
                }))) {
                  allResults.push(...results);
                }

                if (signal.aborted) return;

                for (const r of allResults) {
                  if (overriddenSenders.has(r.from)) continue;
                  if (senderDecisions.get(r.from) !== "keep") {
                    senderDecisions.set(r.from, r.recommendation);
                  }
                }

                const deleteUids = allResults
                  .filter((r) => senderDecisions.get(r.from) === "delete")
                  .map((r) => r.uid);

                const headerMap = await fetchUnsubscribeHeaders(deleteUids);
                const seenUrls = new Set<string>();
                const unsubscribeEntries: UnsubscribeEntry[] = [];
                for (const [, headers] of headerMap) {
                  const entry = buildUnsubscribeEntry(headers.listUnsubscribe, headers.listUnsubscribePost);
                  if (entry && !seenUrls.has(entry.url)) {
                    seenUrls.add(entry.url);
                    unsubscribeEntries.push(entry);
                  }
                }

                if (signal.aborted) return;

                send({ deletingPhase: { emailCount: deleteUids.length, unsubscribeEntries } });

                const deleted = await deleteEmailsByUid(deleteUids);

                send({ done: true, summary: { analyzed: cleanTotal, deleted, minUid } });
              } catch (err) {
                send({ error: formatError(err) });
              } finally {
                clearInterval(heartbeat);
                try {
                  controller.close();
                } catch {}
              }
            })();
          },
          cancel() {
            abort.abort();
          },
        });

        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
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

    "/api/email/unsubscribe-batch": {
      async POST(req) {
        const { entries } = (await req.json()) as {
          entries: Array<{ url: string; oneClick: boolean }>;
        };
        const sent = await batchUnsubscribe(entries);
        return Response.json({ sent });
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
