import type { PreviewResult } from "../types";
import "./PreviewSection.css";
import { displaySender } from "../lib/emailParsing";

interface Props {
  previewResult: PreviewResult | null;
  previewProgress: { scanned: number; total: number } | null;
  previewOverrides: Record<string, "keep" | "delete">;
  togglePreviewSender: (from: string, agentDecision: "keep" | "delete") => void;
  autoClean: (decisions: Record<string, "keep" | "delete">) => void;
  onCancel: () => void;
}

type SenderWithDecision = {
  from: string;
  subjects: string[];
  agentDecision: "keep" | "delete";
};

function SenderRow({ s, side, onToggle }: {
  s: SenderWithDecision;
  side: "delete" | "keep";
  onToggle: () => void;
}) {
  return (
    <div className="preview-sender">
      <div className="preview-sender-row">
        <div className="preview-sender-info">
          <div className="preview-sender-name">{displaySender(s.from)}</div>
          {s.subjects.map((sub, i) => (
            <div key={i} className="preview-subject">{sub}</div>
          ))}
        </div>
        <button
          className={`preview-toggle preview-toggle-${side === "delete" ? "keep" : "delete"}`}
          onClick={onToggle}
          title={side === "delete" ? "Move to Keep" : "Move to Delete"}
        >
          {side === "delete" ? "Keep" : "Delete"}
        </button>
      </div>
    </div>
  );
}

export function PreviewSection({ previewResult, previewProgress, previewOverrides, togglePreviewSender, autoClean, onCancel }: Props) {
  if (!previewResult) {
    return (
      <div className="preview-section">
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
      </div>
    );
  }

  const allSenders: SenderWithDecision[] = [
    ...previewResult.toDelete.map(s => ({ ...s, agentDecision: "delete" as const })),
    ...previewResult.toKeep.map(s => ({ ...s, agentDecision: "keep" as const })),
  ];

  const effectiveDecision = (from: string, agent: "keep" | "delete") => previewOverrides[from] ?? agent;

  const effectiveDelete = allSenders.filter(s => effectiveDecision(s.from, s.agentDecision) === "delete");
  const effectiveKeep   = allSenders.filter(s => effectiveDecision(s.from, s.agentDecision) === "keep");

  const finalDecisions = Object.fromEntries(
    allSenders.map(s => [s.from, effectiveDecision(s.from, s.agentDecision)])
  );

  return (
    <div className="preview-section">
      <p className="preview-summary">
        Sampled <strong>{previewResult.scanned}</strong> of <strong>{previewResult.total}</strong> emails &mdash; See emails in the wrong bucket? Move them over so it cleans correctly.
      </p>
      <div className="preview-columns">
        <div className="preview-col preview-col-delete">
          <div className="preview-col-header">Delete <span className="preview-count">{effectiveDelete.length} senders</span></div>
          {effectiveDelete.map(s => (
            <SenderRow key={s.from} s={s} side="delete" onToggle={() => togglePreviewSender(s.from, s.agentDecision)} />
          ))}
          {effectiveDelete.length === 0 && <div className="preview-empty">Nothing to delete</div>}
        </div>
        <div className="preview-col preview-col-keep">
          <div className="preview-col-header">Keep <span className="preview-count">{effectiveKeep.length} senders</span></div>
          {effectiveKeep.map(s => (
            <SenderRow key={s.from} s={s} side="keep" onToggle={() => togglePreviewSender(s.from, s.agentDecision)} />
          ))}
          {effectiveKeep.length === 0 && <div className="preview-empty">No keepers found</div>}
        </div>
      </div>
      <div className="preview-actions">
        <button onClick={onCancel} className="cancel-button">Cancel</button>
        <button onClick={() => autoClean(finalDecisions)} className="auto-clean-button">Run Auto-Clean</button>
      </div>
    </div>
  );
}
