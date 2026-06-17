import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { EmailItem, Phase } from "../types";
import { displaySender } from "../lib/emailParsing";

interface Deps {
  emails: EmailItem[];
  setEmails: Dispatch<SetStateAction<EmailItem[]>>;
  setPhase: Dispatch<SetStateAction<Phase>>;
  setDeletedCount: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function useDeleteActions({ emails, setEmails, setPhase, setDeletedCount, setError }: Deps) {
  const [rowStates, setRowStates] = useState<Record<string, "loading" | "err" | "exiting">>({});
  const [catStates, setCatStates] = useState<Record<string, "loading" | "err">>({});
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [nukeConfirm, setNukeConfirm] = useState(false);
  const [nuking, setNuking] = useState(false);
  const [nukeResult, setNukeResult] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const clearRowErr = (key: string) =>
    setTimeout(() => setRowStates(s => { const n = { ...s }; delete n[key]; return n; }), 2500);
  const clearCatErr = (cat: string) =>
    setTimeout(() => setCatStates(s => { const n = { ...s }; delete n[cat]; return n; }), 2500);

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
      setRowStates(s => ({ ...s, [key]: "exiting" }));
      setTimeout(() => {
        setEmails(prev => prev.filter(e => e.uid !== email.uid));
        setRowStates(s => { const n = { ...s }; delete n[key]; return n; });
      }, 280);
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
      const { deleted } = await res.json();
      setEmails(prev => prev.filter(e => e.from !== email.from));
      setRowStates(s => { const n = { ...s }; delete n[key]; return n; });
      showToast(`Deleted ${deleted} email${deleted !== 1 ? "s" : ""} from ${displaySender(email.from)}`);
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

  return {
    rowStates, catStates, confirmBusy,
    nukeConfirm, setNukeConfirm, nuking, nukeResult,
    toast,
    deleteOne, deleteSender, deleteCategory, nuke, confirmDelete,
  };
}
