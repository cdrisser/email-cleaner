export interface UnsubscribeEntry {
  url: string;
  oneClick: boolean;
}

export function parseUnsubscribeUrls(header: string): string[] {
  const urls: string[] = [];
  const matches = header.matchAll(/<([^>]+)>/g);
  for (const m of matches) {
    if (m[1]) urls.push(m[1].trim());
  }
  return urls;
}

export function buildUnsubscribeEntry(
  listUnsubscribe: string,
  listUnsubscribePost?: string
): UnsubscribeEntry | null {
  const urls = parseUnsubscribeUrls(listUnsubscribe);
  const httpUrl = urls.find((u) => u.startsWith("http://") || u.startsWith("https://"));
  if (!httpUrl) return null;
  const oneClick = !!listUnsubscribePost?.toLowerCase().includes("list-unsubscribe=one-click");
  return { url: httpUrl, oneClick };
}

export async function sendUnsubscribeRequest(url: string, oneClick: boolean): Promise<boolean> {
  try {
    const res = await (oneClick
      ? fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "List-Unsubscribe=One-Click",
          signal: AbortSignal.timeout(10_000),
        })
      : fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) }));
    return res.ok;
  } catch {
    return false;
  }
}

export async function batchUnsubscribe(entries: UnsubscribeEntry[]): Promise<number> {
  const results = await Promise.all(entries.map((e) => sendUnsubscribeRequest(e.url, e.oneClick)));
  return results.filter(Boolean).length;
}
