import type { EmailItem } from "../types";

export function extractNextEmail(text: string, from: number): { email: EmailItem; next: number } | null {
  const start = text.indexOf("{", from);
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1));
          if (obj.uid && obj.recommendation) {
            return { email: { ...obj, category: obj.category ?? "other", userDecision: obj.recommendation }, next: i + 1 };
          }
        } catch {}
        return extractNextEmail(text, start + 1);
      }
    }
  }
  return null;
}

export function displaySender(from: string): string {
  const nameMatch = from.match(/^(.+?)\s*<[^>]+>/);
  if (nameMatch) return nameMatch?.[1]?.trim() || '';
  const emailMatch = from.match(/<([^>]+)>/);
  return emailMatch ? emailMatch?.[1] || '' : from;
}
