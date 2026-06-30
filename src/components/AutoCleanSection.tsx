import { useState } from "react";
import type { UnsubscribeEntry } from "../lib/unsubscribe";
import "./AutoCleanSection.css";

interface Props {
  autoResult: { analyzed: number; deleted: number } | null;
  autoProgress: { analyzed: number; total: number } | null;
  deletingPhase: { emailCount: number; unsubscribeEntries: UnsubscribeEntry[] } | null;
  unsubResult: number | null;
  unsubscribeAll: (entries: UnsubscribeEntry[]) => Promise<void>;
  onDone: () => void;
}

export function AutoCleanSection({
  autoResult,
  autoProgress,
  deletingPhase,
  unsubResult,
  unsubscribeAll,
  onDone,
}: Props) {
  const [unsubPending, setUnsubPending] = useState(false);
  const [unsubClicked, setUnsubClicked] = useState(false);

  if (autoResult) {
    return (
      <div className="auto-clean-section">
        <div className="auto-clean-result">
          <p>
            Analyzed <strong>{autoResult.analyzed.toLocaleString()}</strong> emails
            &nbsp;&middot;&nbsp; Deleted <strong>{autoResult.deleted.toLocaleString()}</strong>
            {unsubResult != null && unsubResult > 0 && (
              <>
                &nbsp;&middot;&nbsp; Unsubscribed from <strong>{unsubResult}</strong> sender
                {unsubResult !== 1 ? "s" : ""}
              </>
            )}
          </p>
          <button onClick={onDone} className="scan-button">
            Done
          </button>
        </div>
      </div>
    );
  }

  if (deletingPhase) {
    const hasUnsub = deletingPhase.unsubscribeEntries.length > 0;
    const handleUnsub = async () => {
      setUnsubClicked(true);
      setUnsubPending(true);
      await unsubscribeAll(deletingPhase.unsubscribeEntries);
      setUnsubPending(false);
    };

    return (
      <div className="auto-clean-section">
        <div className="auto-clean-progress">
          <p className="auto-clean-status">
            <span className="spinner" style={{ marginRight: "0.5rem" }} />
            Deleting <strong>{deletingPhase.emailCount.toLocaleString()}</strong> emails&hellip;
          </p>
          {hasUnsub && (
            <label className="unsub-checkbox-label">
              <input
                type="checkbox"
                disabled={unsubClicked}
                onChange={e => { if (e.target.checked) handleUnsub(); }}
              />
              {unsubPending ? (
                <><span className="spinner" /> Unsubscribing&hellip;</>
              ) : (
                `Also unsubscribe from ${deletingPhase.unsubscribeEntries.length} sender${deletingPhase.unsubscribeEntries.length !== 1 ? "s" : ""}`
              )}
            </label>
          )}
        </div>
      </div>
    );
  }

  if (autoProgress) {
    return (
      <div className="auto-clean-section">
        <div className="auto-clean-progress">
          <p className="auto-clean-status">
            Analyzing inbox&hellip; <strong>{autoProgress.analyzed}</strong>
            {autoProgress.total ? ` / ${autoProgress.total}` : ""} emails
          </p>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: autoProgress.total
                  ? `${Math.round((autoProgress.analyzed / autoProgress.total) * 100)}%`
                  : "0%",
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
}
