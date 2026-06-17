export interface EmailItem {
  uid: number;
  from: string;
  subject: string;
  date: string;
  category: string;
  recommendation: "keep" | "delete";
  reason: string;
  userDecision: "keep" | "delete";
}

export type Phase = "idle" | "scanning" | "reviewing" | "done" | "auto-cleaning" | "previewing";

export interface SenderGroup { from: string; subjects: string[] }
export interface PreviewResult { toDelete: SenderGroup[]; toKeep: SenderGroup[]; scanned: number; total: number }
