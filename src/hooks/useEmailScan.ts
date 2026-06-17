import type { Dispatch, SetStateAction } from "react";
import type { EmailItem, Phase } from "../types";
import { extractNextEmail } from "../lib/emailParsing";

export function useEmailScan(
  setPhase: Dispatch<SetStateAction<Phase>>,
  setError: Dispatch<SetStateAction<string | null>>,
  setEmails: Dispatch<SetStateAction<EmailItem[]>>,
) {
  const scan = async () => {
    setPhase("scanning");
    setEmails([]);
    setError(null);

    try {
      const res = await fetch("/api/email/scan", { method: "POST" });
      if (!res.ok || !res.body) throw new Error(`Scan failed: HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let accumulated = "";
      let parseFrom = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split("\n\n");
        sseBuffer = events.pop() ?? "";

        for (const raw of events) {
          if (!raw.startsWith("data: ")) continue;
          let msg: { chunk?: string; done?: boolean; error?: string };
          try { msg = JSON.parse(raw.slice(6)); } catch { continue; }

          if (msg.error) { setError(msg.error); setPhase("idle"); return; }
          if (msg.done) { setPhase("reviewing"); return; }

          if (msg.chunk) {
            accumulated += msg.chunk;
            let result = extractNextEmail(accumulated, parseFrom);
            while (result) {
              const { email, next } = result;
              setEmails(prev => [...prev, email]);
              parseFrom = next;
              result = extractNextEmail(accumulated, parseFrom);
            }
          }
        }
      }

      setPhase("reviewing");
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  };

  const toggle = (uid: number) => {
    setEmails(prev =>
      prev.map(e =>
        e.uid === uid ? { ...e, userDecision: e.userDecision === "delete" ? "keep" : "delete" } : e
      )
    );
  };

  return { scan, toggle };
}
