import { useState } from "react";
import type { EmailItem, Phase } from "./types";
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
    autoProgress, autoResult,
    previewInbox, autoClean, togglePreviewSender, resetPreview,
  } = useAutoClean(setPhase, setError);

  const showList = phase === "scanning" || phase === "reviewing" || phase === "done";

  return (
    <div className="email-cleaner">
      <h2 className="email-cleaner-title">Yahoo Inbox Cleaner</h2>

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
          toggle={toggle}
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
