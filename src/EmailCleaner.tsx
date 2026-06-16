import { useState } from "react";

interface EmailItem {
  uid: number;
  from: string;
  subject: string;
  date: string;
  category: string;
  recommendation: "keep" | "delete";
  reason: string;
  userDecision: "keep" | "delete";
}

type Phase = "idle" | "scanning" | "reviewing" | "done" | "auto-cleaning" | "previewing";

interface SenderGroup { from: string; subjects: string[] }
interface PreviewResult { toDelete: SenderGroup[]; toKeep: SenderGroup[]; scanned: number; total: number }

function displaySender(from: string) {
  const nameMatch = from.match(/^(.+?)\s*<[^>]+>/);
  if (nameMatch) return nameMatch[1].trim();
  const emailMatch = from.match(/<([^>]+)>/);
  return emailMatch ? emailMatch[1] : from;
}

function extractNextEmail(text: string, from: number): { email: EmailItem; next: number } | null {
  const start = text.indexOf("{", from);
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1));
          if (obj.uid && obj.recommendation) {
            return { email: { ...obj, category: obj.category ?? "other", userDecision: obj.recommendation }, next: i + 1 };
          }
        } catch {}
        return extractNextEmail(text, start + 1);
      }
    }
  }
  return null;
}

export function EmailCleaner() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [deletedCount, setDeletedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, "loading" | "err">>({});
  const [catStates, setCatStates] = useState<Record<string, "loading" | "err">>({});
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [nukeConfirm, setNukeConfirm] = useState(false);
  const [nuking, setNuking] = useState(false);
  const [nukeResult, setNukeResult] = useState<number | null>(null);
  const [autoProgress, setAutoProgress] = useState<{ analyzed: number; total: number } | null>(null);
  const [autoResult, setAutoResult] = useState<{ analyzed: number; deleted: number } | null>(null);
  const [previewProgress, setPreviewProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, "keep" | "delete">>({});

  const togglePreviewSender = (from: string, agentDecision: "keep" | "delete") => {
    const current = previewOverrides[from] ?? agentDecision;
    setPreviewOverrides(prev => ({ ...prev, [from]: current === "keep" ? "delete" : "keep" }));
  };

  const clearRowErr = (key: string) =>
    setTimeout(() => setRowStates(s => { const n = { ...s }; delete n[key]; return n; }), 2500);
  const clearCatErr = (cat: string) =>
    setTimeout(() => setCatStates(s => { const n = { ...s }; delete n[cat]; return n; }), 2500);

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
          if (msg.done)  { setPhase("reviewing"); return; }

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

  const deleteOne = async (email: EmailItem) => {
    const key = `${email.uid}-one`;
    setRowStates(s => ({ ...s, [key]: "loading" }));
    setError(null);
    try {
      const res = await fetch("/api/email/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uids: [email.uid] }),
      });
      if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
      setEmails(prev => prev.filter(e => e.uid !== email.uid));
      setRowStates(s => { const n = { ...s }; delete n[key]; return n; });
    } catch (err) {
      setError(String(err));
      setRowStates(s => ({ ...s, [key]: "err" }));
      clearRowErr(key);
    }
  };

  const deleteSender = async (email: EmailItem) => {
    const key = `${email.uid}-sender`;
    setRowStates(s => ({ ...s, [key]: "loading" }));
    setError(null);
    try {
      const res = await fetch("/api/email/delete/sender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: email.from }),
      });
      if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
      setEmails(prev => prev.filter(e => e.from !== email.from));
      setRowStates(s => { const n = { ...s }; delete n[key]; return n; });
    } catch (err) {
      setError(String(err));
      setRowStates(s => ({ ...s, [key]: "err" }));
      clearRowErr(key);
    }
  };

  const deleteCategory = async (category: string, categoryEmails: EmailItem[]) => {
    setCatStates(s => ({ ...s, [category]: "loading" }));
    setError(null);
    try {
      const res = await fetch("/api/email/delete/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, localUids: categoryEmails.map(e => e.uid) }),
      });
      if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
      setEmails(prev => prev.filter(e => e.category !== category));
      setCatStates(s => { const n = { ...s }; delete n[category]; return n; });
    } catch (err) {
      setError(String(err));
      setCatStates(s => ({ ...s, [category]: "err" }));
      clearCatErr(category);
    }
  };

  const nuke = async () => {
    setNuking(true);
    setNukeConfirm(false);
    setError(null);
    try {
      const res = await fetch("/api/email/delete/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "promotional", localUids: [] }),
      });
      if (!res.ok) throw new Error(`Nuke failed: HTTP ${res.status}`);
      const { deleted } = await res.json();
      setNukeResult(deleted);
    } catch (err) {
      setError(String(err));
    } finally {
      setNuking(false);
    }
  };

  const confirmDelete = async () => {
    const toDelete = emails.filter(e => e.userDecision === "delete").map(e => e.uid);
    setConfirmBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/email/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uids: toDelete }),
      });
      if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
      setDeletedCount(toDelete.length);
      setEmails(prev => prev.filter(e => e.userDecision === "keep"));
      setPhase("done");
    } catch (err) {
      setError(String(err));
    } finally {
      setConfirmBusy(false);
    }
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
          let msg: { init?: { total: number }; progress?: { scanned: number }; done?: boolean; preview?: PreviewResult; error?: string };
          try { msg = JSON.parse(raw.slice(6)); } catch { continue; }

          if (msg.error) { setError(msg.error); setPhase("idle"); return; }
          if (msg.init) setPreviewProgress({ scanned: 0, total: msg.init.total });
          if (msg.progress) setPreviewProgress(p => ({ scanned: msg.progress!.scanned, total: p?.total ?? 0 }));
          if (msg.done && msg.preview) { setPreviewResult(msg.preview); return; }
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
          let msg: { progress?: { analyzed: number; total: number }; done?: boolean; summary?: { analyzed: number; deleted: number }; error?: string };
          try { msg = JSON.parse(raw.slice(6)); } catch { continue; }

          if (msg.error) { setError(msg.error); setPhase("idle"); return; }
          if (msg.progress) setAutoProgress(msg.progress);
          if (msg.done && msg.summary) { setAutoResult(msg.summary); return; }
        }
      }
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  };

  const CATEGORY_ORDER = ["promotional", "newsletter", "social", "travel", "food", "automated", "spam", "financial", "personal"];
  const KEEP_CATEGORIES = new Set(["financial", "personal"]);

  const toDeleteCount = emails.filter(e => e.userDecision === "delete").length;
  const toKeepCount  = emails.filter(e => e.userDecision === "keep").length;
  const showList     = phase === "scanning" || phase === "reviewing";

  const grouped = emails.reduce((acc, e) => {
    const cat = e.category || "other";
    (acc[cat] ??= []).push(e);
    return acc;
  }, {} as Record<string, EmailItem[]>);

  const sortedCats = Object.keys(grouped).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <div className="email-cleaner">
      <h2 className="email-cleaner-title">Yahoo Inbox Cleaner</h2>

      {error && <div className="email-error">{error}</div>}

      {phase === "previewing" && (
        <div className="preview-section">
          {previewResult ? (() => {
            const allSenders = [
              ...previewResult.toDelete.map(s => ({ ...s, agentDecision: "delete" as const })),
              ...previewResult.toKeep.map(s => ({ ...s, agentDecision: "keep" as const })),
            ];
            const effectiveDecision = (from: string, agent: "keep" | "delete") =>
              previewOverrides[from] ?? agent;

            const effectiveDelete = allSenders.filter(s => effectiveDecision(s.from, s.agentDecision) === "delete");
            const effectiveKeep   = allSenders.filter(s => effectiveDecision(s.from, s.agentDecision) === "keep");

            const finalDecisions = Object.fromEntries(
              allSenders.map(s => [s.from, effectiveDecision(s.from, s.agentDecision)])
            );

            const SenderRow = ({ s, side }: { s: typeof allSenders[0]; side: "delete" | "keep" }) => (
              <div className="preview-sender">
                <div className="preview-sender-row">
                  <div className="preview-sender-info">
                    <div className="preview-sender-name">{displaySender(s.from)}</div>
                    {s.subjects.map((sub, i) => <div key={i} className="preview-subject">{sub}</div>)}
                  </div>
                  <button
                    className={`preview-toggle preview-toggle-${side === "delete" ? "keep" : "delete"}`}
                    onClick={() => togglePreviewSender(s.from, s.agentDecision)}
                    title={side === "delete" ? "Move to Keep" : "Move to Delete"}
                  >
                    {side === "delete" ? "Keep" : "Delete"}
                  </button>
                </div>
              </div>
            );

            return (
              <>
                <p className="preview-summary">
                  Sampled <strong>{previewResult.scanned}</strong> of <strong>{previewResult.total}</strong> emails &mdash; See emails in the wrong bucket? Move them over so it cleans correctly.
                </p>
                <div className="preview-columns">
                  <div className="preview-col preview-col-delete">
                    <div className="preview-col-header">Delete <span className="preview-count">{effectiveDelete.length} senders</span></div>
                    {effectiveDelete.map(s => <SenderRow key={s.from} s={s} side="delete" />)}
                    {effectiveDelete.length === 0 && <div className="preview-empty">Nothing to delete</div>}
                  </div>
                  <div className="preview-col preview-col-keep">
                    <div className="preview-col-header">Keep <span className="preview-count">{effectiveKeep.length} senders</span></div>
                    {effectiveKeep.map(s => <SenderRow key={s.from} s={s} side="keep" />)}
                    {effectiveKeep.length === 0 && <div className="preview-empty">No keepers found</div>}
                  </div>
                </div>
                <div className="preview-actions">
                  <button onClick={() => { setPhase("idle"); setPreviewResult(null); setPreviewProgress(null); setPreviewOverrides({}); }} className="cancel-button">Cancel</button>
                  <button onClick={() => autoClean(finalDecisions)} className="auto-clean-button">Run Auto-Clean</button>
                </div>
              </>
            );
          })() : (
            <div className="auto-clean-progress">
              <p className="auto-clean-status">
                Analyzing sample&hellip;{previewProgress && previewProgress.scanned > 0 ? ` ${previewProgress.scanned} emails scanned` : ""}
              </p>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: previewProgress?.total ? `${Math.round((previewProgress.scanned / Math.min(200, previewProgress.total)) * 100)}%` : "5%" }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "auto-cleaning" && (
        <div className="auto-clean-section">
          {autoResult ? (
            <div className="auto-clean-result">
              <p>Analyzed <strong>{autoResult.analyzed}</strong> emails &middot; Deleted <strong>{autoResult.deleted}</strong></p>
              <button onClick={() => { setPhase("idle"); setAutoResult(null); setAutoProgress(null); }} className="scan-button">Done</button>
            </div>
          ) : autoProgress ? (
            <div className="auto-clean-progress">
              <p className="auto-clean-status">
                Analyzing inbox&hellip; <strong>{autoProgress.analyzed}</strong>{autoProgress.total ? ` / ${autoProgress.total}` : ""} emails
              </p>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: autoProgress.total ? `${Math.round((autoProgress.analyzed / autoProgress.total) * 100)}%` : "0%" }}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {phase === "idle" && (
        <div className="idle-actions">
          <button onClick={scan} className="scan-button">Scan Inbox</button>
          <div className="nuke-section">
            {nukeResult !== null ? (
              <button className="nuke-button nuke-done" disabled>
                Deleted {nukeResult} promotional emails
              </button>
            ) : nuking ? (
              <button className="nuke-button" disabled><span className="spinner" /> Nuking...</button>
            ) : !nukeConfirm ? (
              <button onClick={() => setNukeConfirm(true)} className="nuke-button">
                Nuke All Promotional
              </button>
            ) : (
              <div className="nuke-confirm">
                <p className="nuke-warning">
                  Permanently deletes all emails with unsubscribe links across your <strong>entire inbox</strong>. This cannot be undone.
                </p>
                <div className="nuke-confirm-actions">
                  <button onClick={() => setNukeConfirm(false)} className="cancel-button">Cancel</button>
                  <button onClick={nuke} className="nuke-confirm-btn">Yes, nuke it</button>
                </div>
              </div>
            )}
          </div>
          <div className="auto-clean-section">
            <div className="auto-clean-row">
              <button onClick={previewInbox} className="auto-clean-button">Preview Auto-Clean</button>
              <button onClick={() => autoClean()} className="auto-clean-button auto-clean-button-full">Run Auto-Clean</button>
            </div>
            <p className="auto-clean-hint">Preview shows what would be deleted from a 200-email sample &middot; Run cleans the entire inbox</p>
          </div>
        </div>
      )}

      {phase === "scanning" && emails.length === 0 && (
        <p className="email-status">Fetching and analyzing your inbox...</p>
      )}

      {showList && emails.length > 0 && (
        <>
          <div className="email-summary">
            <span className="summary-delete">{toDeleteCount} to delete</span>
            <span className="summary-keep">{toKeepCount} to keep</span>
            {phase === "scanning" && <span className="email-status scanning-inline">analyzing...</span>}
          </div>

          <div className="email-list">
            {sortedCats.map(category => {
              const group = grouped[category] ?? [];
              return (
                <div key={category} className="category-group">
                  <div className="category-header">
                    <div className="category-header-info">
                      <span className={`category-badge cat-${category}`}>{category}</span>
                      <span className="category-count">{group.length} email{group.length !== 1 ? "s" : ""}</span>
                    </div>
                    {!KEEP_CATEGORIES.has(category) && (() => {
                      const cs = catStates[category];
                      return (
                        <button
                          onClick={() => deleteCategory(category, group)}
                          className="delete-category-btn"
                          disabled={!!cs}
                          title={`Delete all ${category} emails across inbox`}
                        >
                          {cs === "loading" ? <><span className="spinner" /></> : cs === "err" ? "✗ Failed" : `Delete all ${category}`}
                        </button>
                      );
                    })()}
                  </div>

                  {group.map(email => (
                    <div
                      key={email.uid}
                      className={`email-row ${email.userDecision === "delete" ? "marked-delete" : "marked-keep"}`}
                    >
                      <div className="email-info">
                        <div className="email-from">{email.from}</div>
                        <div className="email-subject">{email.subject}</div>
                        <div className="email-meta">
                          <span className="email-date">{email.date}</span>
                          <span className="email-reason">{email.reason}</span>
                        </div>
                      </div>
                      <div className="row-controls">
                        <button onClick={() => toggle(email.uid)} className={`decision-btn ${email.userDecision === "delete" ? "btn-delete" : "btn-keep"}`}>
                          {email.userDecision === "delete" ? "Delete" : "Keep"}
                        </button>
                        {email.userDecision === "keep" && (
                          <button onClick={() => toggle(email.uid)} className="decision-btn btn-delete">
                            Delete
                          </button>
                        )}
                        <div className="row-actions">
                          {(() => {
                            const stOne = rowStates[`${email.uid}-one`];
                            const stSender = rowStates[`${email.uid}-sender`];
                            return (
                              <>
                                <button onClick={() => deleteOne(email)} className="row-btn row-btn-one" disabled={!!stOne || !!stSender} title="Delete this email">
                                  {stOne === "loading" ? <span className="spinner" /> : stOne === "err" ? "✗" : "This"}
                                </button>
                                <button onClick={() => deleteSender(email)} className="row-btn row-btn-sender" disabled={!!stOne || !!stSender} title={`Delete all from ${email.from}`}>
                                  {stSender === "loading" ? <span className="spinner" /> : stSender === "err" ? "✗" : "All from sender"}
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {phase === "reviewing" && (
            <div className="email-actions">
              <button onClick={() => { setPhase("idle"); setEmails([]); }} className="cancel-button">
                Cancel
              </button>
              <button onClick={confirmDelete} className="confirm-delete-button" disabled={confirmBusy || toDeleteCount === 0}>
                {confirmBusy ? <><span className="spinner" /> Deleting...</> : `Delete ${toDeleteCount} selected`}
              </button>
            </div>
          )}
        </>
      )}

      {phase === "done" && (
        <div className="email-done">
          <p>Deleted {deletedCount} emails.</p>
          <button onClick={() => { setPhase("idle"); setEmails([]); }} className="scan-button">
            Scan Again
          </button>
        </div>
      )}
    </div>
  );
}
