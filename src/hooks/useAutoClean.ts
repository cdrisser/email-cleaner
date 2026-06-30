import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Phase, PreviewResult } from "../types";
import type { UnsubscribeEntry } from "../lib/unsubscribe";

export function useAutoClean(
  setPhase: Dispatch<SetStateAction<Phase>>,
  setError: Dispatch<SetStateAction<string | null>>
) {
  const [previewProgress, setPreviewProgress] = useState<{ scanned: number; total: number; currentSubject?: string } | null>(
    null
  );
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, "keep" | "delete">>({});
  const [autoProgress, setAutoProgress] = useState<{ analyzed: number; total: number } | null>(
    null
  );
  const [autoResult, setAutoResult] = useState<{ analyzed: number; deleted: number } | null>(null);
  const [deletingPhase, setDeletingPhase] = useState<{
    emailCount: number;
    unsubscribeEntries: UnsubscribeEntry[];
  } | null>(null);
  const [unsubResult, setUnsubResult] = useState<number | null>(null);

  const togglePreviewSender = (from: string, agentDecision: "keep" | "delete") => {
    const current = previewOverrides[from] ?? agentDecision;
    setPreviewOverrides((prev) => ({ ...prev, [from]: current === "keep" ? "delete" : "keep" }));
  };

  const resetPreview = () => {
    setPreviewResult(null);
    setPreviewProgress(null);
    setPreviewOverrides({});
  };

  const previewInbox = async () => {
    setPhase("previewing");
    setPreviewProgress(null);
    setPreviewResult(null);
    setError(null);
    try {
      const res = await fetch("/api/email/auto-clean/preview", { method: "POST" });
      if (!res.ok || !res.body) throw new Error(`Preview failed: HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split("\n\n");
        sseBuffer = events.pop() ?? "";

        for (const raw of events) {
          if (!raw.startsWith("data: ")) continue;
          let msg: {
            init?: { total: number };
            progress?: { scanned: number; currentSubject?: string };
            done?: boolean;
            preview?: PreviewResult;
            error?: string;
          };
          try {
            msg = JSON.parse(raw.slice(6));
          } catch {
            continue;
          }

          if (msg.error) {
            setError(msg.error);
            setPhase("idle");
            return;
          }
          if (msg.init) setPreviewProgress({ scanned: 0, total: msg.init.total });
          if (msg.progress)
            setPreviewProgress((p) => ({ scanned: msg.progress!.scanned, total: p?.total ?? 0, currentSubject: msg.progress!.currentSubject }));
          if (msg.done && msg.preview) {
            setPreviewResult(msg.preview);
            return;
          }
        }
      }
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  };

  const autoClean = async (knownDecisions?: Record<string, "keep" | "delete">) => {
    setPhase("auto-cleaning");
    setAutoProgress({ analyzed: 0, total: 0 });
    setAutoResult(null);
    setDeletingPhase(null);
    setUnsubResult(null);
    setError(null);
    try {
      const res = await fetch("/api/email/auto-clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knownDecisions: knownDecisions ?? {} }),
      });
      if (!res.ok || !res.body) throw new Error(`Auto-clean failed: HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split("\n\n");
        sseBuffer = events.pop() ?? "";

        for (const raw of events) {
          if (!raw.startsWith("data: ")) continue;
          let msg: {
            progress?: { analyzed: number; total: number };
            deletingPhase?: { emailCount: number; unsubscribeEntries: UnsubscribeEntry[] };
            done?: boolean;
            summary?: { analyzed: number; deleted: number };
            error?: string;
          };
          try {
            msg = JSON.parse(raw.slice(6));
          } catch {
            continue;
          }

          if (msg.error) {
            setError(msg.error);
            setPhase("idle");
            return;
          }
          if (msg.progress) setAutoProgress(msg.progress);
          if (msg.deletingPhase) setDeletingPhase(msg.deletingPhase);
          if (msg.done && msg.summary) {
            setAutoResult(msg.summary);
            return;
          }
        }
      }
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  };

  const unsubscribeAll = async (entries: UnsubscribeEntry[]) => {
    try {
      const res = await fetch("/api/email/unsubscribe-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) return;
      const { sent } = await res.json();
      setUnsubResult(sent);
    } catch {}
  };

  return {
    previewProgress,
    previewResult,
    previewOverrides,
    autoProgress,
    autoResult,
    deletingPhase,
    unsubResult,
    previewInbox,
    autoClean,
    togglePreviewSender,
    resetPreview,
    unsubscribeAll,
  };
}
