import "./EmailList.css";
import type { EmailItem, Phase } from "../types";

const CATEGORY_ORDER = ["promotional", "newsletter", "social", "travel", "food", "automated", "spam", "financial", "personal"];
const KEEP_CATEGORIES = new Set(["financial", "personal"]);

interface Props {
  emails: EmailItem[];
  phase: Phase;
  catStates: Record<string, "loading" | "err">;
  rowStates: Record<string, "loading" | "err" | "exiting">;
  confirmBusy: boolean;
  deletedCount: number;
  toggle: (uid: number) => void;
  deleteOne: (email: EmailItem) => void;
  deleteSender: (email: EmailItem) => void;
  deleteCategory: (category: string, emails: EmailItem[]) => void;
  confirmDelete: () => void;
  onCancel: () => void;
}

export function EmailList({
  emails, phase, catStates, rowStates, confirmBusy, deletedCount,
  toggle, deleteOne, deleteSender, deleteCategory, confirmDelete, onCancel,
}: Props) {
  const toDeleteCount = emails.filter(e => e.userDecision === "delete").length;
  const toKeepCount   = emails.filter(e => e.userDecision === "keep").length;

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

  if (phase === "done") {
    return (
      <div className="email-done">
        <p>Deleted {deletedCount} emails.</p>
        <button onClick={onCancel} className="scan-button">Scan Again</button>
      </div>
    );
  }

  if (emails.length === 0) {
    return phase === "scanning" ? <p className="email-status">Fetching and analyzing your inbox...</p> : null;
  }

  return (
    <>
      <div className="email-summary">
        <span className="summary-delete">{toDeleteCount} to delete</span>
        <span className="summary-keep">{toKeepCount} to keep</span>
        {phase === "scanning" && <span className="email-status scanning-inline">analyzing...</span>}
      </div>

      <div className="email-list">
        {sortedCats.map(category => {
          const group = grouped[category] ?? [];
          const cs = catStates[category];
          return (
            <div key={category} className="category-group">
              <div className="category-header">
                <div className="category-header-info">
                  <span className={`category-badge cat-${category}`}>{category}</span>
                  <span className="category-count">{group.length} email{group.length !== 1 ? "s" : ""}</span>
                </div>
                {!KEEP_CATEGORIES.has(category) && (
                  <button
                    onClick={() => deleteCategory(category, group)}
                    className="delete-category-btn"
                    disabled={!!cs}
                    title={`Delete all ${category} emails across inbox`}
                  >
                    {cs === "loading" ? <><span className="spinner" /></> : cs === "err" ? "✗ Failed" : `Delete all ${category}`}
                  </button>
                )}
              </div>

              {group.map(email => {
                const stOne    = rowStates[`${email.uid}-one`];
                const stSender = rowStates[`${email.uid}-sender`];
                return (
                  <div
                    key={email.uid}
                    className={`email-row ${email.userDecision === "delete" ? "marked-delete" : "marked-keep"}${stOne === "loading" || stSender === "loading" ? " row-busy" : ""}${stOne === "exiting" ? " email-row-exiting" : ""}`}
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
                      <button
                        onClick={() => toggle(email.uid)}
                        className={`decision-btn ${email.userDecision === "delete" ? "btn-delete" : "btn-keep"}`}
                      >
                        {email.userDecision === "delete" ? "Delete" : "Keep"}
                      </button>
                      <div className="row-actions">
                        <button
                          onClick={() => deleteOne(email)}
                          className="row-btn row-btn-one"
                          disabled={!!stOne || !!stSender}
                          title="Delete this email"
                        >
                          {stOne === "loading" ? <span className="spinner" /> : stOne === "err" ? "✗" : "This e-mail"}
                        </button>
                        <button
                          onClick={() => deleteSender(email)}
                          className="row-btn row-btn-sender"
                          disabled={!!stOne || !!stSender}
                          title={`Delete all from ${email.from}`}
                        >
                          {stSender === "loading" ? <span className="spinner" /> : stSender === "err" ? "✗" : "All from sender"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {phase === "reviewing" && (
        <div className="email-actions">
          <button onClick={onCancel} className="cancel-button">Cancel</button>
          <button
            onClick={confirmDelete}
            className="confirm-delete-button"
            disabled={confirmBusy || toDeleteCount === 0}
          >
            {confirmBusy ? <><span className="spinner" /> Deleting...</> : `Delete ${toDeleteCount} selected`}
          </button>
        </div>
      )}
    </>
  );
}
