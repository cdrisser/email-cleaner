interface Props {
  autoResult: { analyzed: number; deleted: number } | null;
  autoProgress: { analyzed: number; total: number } | null;
  onDone: () => void;
}

export function AutoCleanSection({ autoResult, autoProgress, onDone }: Props) {
  if (autoResult) {
    return (
      <div className="auto-clean-section">
        <div className="auto-clean-result">
          <p>Analyzed <strong>{autoResult.analyzed}</strong> emails &middot; Deleted <strong>{autoResult.deleted}</strong></p>
          <button onClick={onDone} className="scan-button">Done</button>
        </div>
      </div>
    );
  }

  if (autoProgress) {
    return (
      <div className="auto-clean-section">
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
      </div>
    );
  }

  return null;
}
