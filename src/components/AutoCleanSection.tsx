import type { UnsubscribeEntry } from "../lib/unsubscribe";
import "./AutoCleanSection.css";

type StepStatus = "pending" | "active" | "complete";

function CleanStep({ status, label, number }: { status: StepStatus; label: string; number: number }) {
  return (
    <div className={`clean-step clean-step--${status}`}>
      <div className="clean-step-indicator">
        {status === "complete" ? "✓" : status === "active" ? <span className="spinner" /> : number}
      </div>
      <span className="clean-step-label">{label}</span>
    </div>
  );
}

interface Props {
  autoResult: { analyzed: number; deleted: number } | null;
  autoProgress: { analyzed: number; total: number } | null;
  deletingPhase: { emailCount: number; unsubscribeEntries: UnsubscribeEntry[] } | null;
  unsubResult: number | null;
  unsubPending: boolean;
  onDone: () => void;
}

export function AutoCleanSection({ autoResult, autoProgress, deletingPhase, unsubResult, unsubPending, onDone }: Props) {
  if (!autoProgress && !deletingPhase && !autoResult) return null;

  let analyzeStatus: StepStatus = "pending";
  let unsubStatus: StepStatus = "pending";
  let deleteStatus: StepStatus = "pending";

  if (autoResult) {
    analyzeStatus = "complete";
    unsubStatus = unsubResult != null ? "complete" : unsubPending ? "active" : "pending";
    deleteStatus = "complete";
  } else if (deletingPhase) {
    analyzeStatus = "complete";
    unsubStatus = unsubResult != null ? "complete" : unsubPending ? "active" : "pending";
    deleteStatus = "active";
  } else if (autoProgress) {
    analyzeStatus = "active";
  }

  return (
    <div className="auto-clean-section">
      <div className="clean-steps">
        <CleanStep status={analyzeStatus} label="Analyze" number={1} />
        <div className={`clean-step-line${analyzeStatus === "complete" ? " clean-step-line--complete" : ""}`} />
        <CleanStep status={unsubStatus} label="Unsubscribe" number={2} />
        <div className={`clean-step-line${unsubStatus === "complete" ? " clean-step-line--complete" : ""}`} />
        <CleanStep status={deleteStatus} label="Delete" number={3} />
      </div>

      {autoResult ? (
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
          <button onClick={onDone} className="scan-button">Done</button>
        </div>
      ) : deletingPhase ? (
        <div className="auto-clean-progress">
          <p className="auto-clean-status">
            <span className="spinner" style={{ marginRight: "0.5rem" }} />
            Deleting <strong>{deletingPhase.emailCount.toLocaleString()}</strong> emails&hellip;
          </p>
        </div>
      ) : autoProgress ? (
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
      ) : null}
    </div>
  );
}
