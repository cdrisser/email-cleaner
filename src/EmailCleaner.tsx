import { useState } from "react";
import type { EmailItem, Phase } from "./types";
import "./EmailCleaner.css";
import { useEmailScan } from "./hooks/useEmailScan";
import { useDeleteActions } from "./hooks/useDeleteActions";
import { useAutoClean } from "./hooks/useAutoClean";
import { PreviewSection } from "./components/PreviewSection";
import { AutoCleanSection } from "./components/AutoCleanSection";
import { IdleActions } from "./components/IdleActions";
import { EmailList } from "./components/EmailList";

export function EmailCleaner() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [deletedCount, setDeletedCount] = useState(0);

  const { scan, toggle } = useEmailScan(setPhase, setError, setEmails);

  const {
    rowStates, catStates, confirmBusy,
    nukeConfirm, setNukeConfirm, nuking, nukeResult,
    toast,
    deleteOne, deleteSender, deleteCategory, nuke, confirmDelete,
  } = useDeleteActions({ emails, setEmails, setPhase, setDeletedCount, setError });

  const {
    previewProgress, previewResult, previewOverrides,
    autoProgress, autoResult, deletingPhase, unsubResult,
    previewInbox, autoClean, togglePreviewSender, resetPreview, unsubscribeAll,
  } = useAutoClean(setPhase, setError);

  const showList = phase === "scanning" || phase === "reviewing" || phase === "done";

  return (
    <div className={`email-cleaner${showList ? " email-cleaner--active" : ""}`}>
      <header className="email-cleaner-header">
        <h2 className="email-cleaner-title">Yahoo Inbox Cleaner</h2>
        <p className="email-cleaner-subtitle">Scan, review, and delete — three steps to a clean inbox.</p>
      </header>

      {error && <div className="email-error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      {phase === "previewing" && (
        <PreviewSection
          previewResult={previewResult}
          previewProgress={previewProgress}
          previewOverrides={previewOverrides}
          togglePreviewSender={togglePreviewSender}
          autoClean={autoClean}
          onCancel={() => { setPhase("idle"); resetPreview(); }}
        />
      )}

      {phase === "auto-cleaning" && (
        <AutoCleanSection
          autoResult={autoResult}
          autoProgress={autoProgress}
          deletingPhase={deletingPhase}
          unsubResult={unsubResult}
          unsubscribeAll={unsubscribeAll}
          onDone={() => { setPhase("idle"); }}
        />
      )}

      {phase === "idle" && (
        <IdleActions
          onScan={scan}
          onPreview={previewInbox}
          onAutoClean={() => autoClean()}
          nukeConfirm={nukeConfirm}
          setNukeConfirm={setNukeConfirm}
          nuking={nuking}
          nukeResult={nukeResult}
          nuke={nuke}
        />
      )}

      {showList && (
        <EmailList
          emails={emails}
          phase={phase}
          catStates={catStates}
          rowStates={rowStates}
          confirmBusy={confirmBusy}
          deletedCount={deletedCount}
          deleteOne={deleteOne}
          deleteSender={deleteSender}
          deleteCategory={deleteCategory}
          confirmDelete={confirmDelete}
          onCancel={() => { setPhase("idle"); setEmails([]); setDeletedCount(0); }}
        />
      )}
    </div>
  );
}
