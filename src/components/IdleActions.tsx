import { useState } from "react";
import "./IdleActions.css";

interface Props {
  onScan: () => void;
  onPreview: () => void;
  onAutoClean: (unsubscribe: boolean) => void;
  nukeConfirm: boolean;
  setNukeConfirm: (v: boolean) => void;
  nuking: boolean;
  nukeResult: number | null;
  nuke: () => void;
}

export function IdleActions({ onScan, onPreview, onAutoClean, nukeConfirm, setNukeConfirm, nuking, nukeResult, nuke }: Props) {
  const [shouldUnsub, setShouldUnsub] = useState(true);

  return (
    <div className="idle-actions">
      <button onClick={onScan} className="scan-button">Scan Inbox</button>

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
          <button onClick={onPreview} className="auto-clean-button">Preview Auto-Clean</button>
          <button onClick={() => onAutoClean(shouldUnsub)} className="auto-clean-button auto-clean-button-full">Run Auto-Clean</button>
          <label className="unsub-checkbox-label">
            <input
              type="checkbox"
              checked={shouldUnsub}
              onChange={e => setShouldUnsub(e.target.checked)}
            />
            Unsubscribe too
          </label>
        </div>
        <p className="auto-clean-hint">Preview shows what would be deleted from a 200-email sample &middot; Run cleans your 100 most recent emails</p>
      </div>
    </div>
  );
}
