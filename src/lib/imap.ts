import { ImapFlow } from "imapflow";

export function createImapClient() {
  return new ImapFlow({
    host: "imap.mail.yahoo.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.YAHOO_EMAIL!,
      pass: process.env.YAHOO_APP_PASSWORD!,
    },
    logger: false,
  });
}

export interface EmailSummary {
  uid: number;
  from: string;
  subject: string;
  date: string;
}

export async function fetchInboxEmails(
  limit = 50
): Promise<{ emails: EmailSummary[]; total: number }> {
  const client = createImapClient();
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen("INBOX");
    const total = mailbox.exists;

    if (total === 0) return { emails: [], total: 0 };

    const start = Math.max(1, total - limit + 1);
    const range = `${start}:${total}`;

    const emails: EmailSummary[] = [];
    for await (const msg of client.fetch(range, { envelope: true, uid: true })) {
      const addr = msg.envelope?.from?.[0];
      const from = addr
        ? `${addr.name ? addr.name + " " : ""}<${addr.address ?? "unknown"}>`
        : "unknown";
      emails.push({
        uid: msg.uid,
        from,
        subject: msg.envelope?.subject || "(no subject)",
        date: msg.envelope?.date?.toISOString().split("T")[0] ?? "unknown",
      });
    }

    return { emails: emails.reverse(), total };
  } finally {
    await client.logout();
  }
}

export async function fetchEmailPage(
  seqStart: number,
  seqEnd: number
): Promise<{ emails: EmailSummary[]; total: number }> {
  const client = createImapClient();
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen("INBOX");
    const total = mailbox.exists;

    if (total === 0 || seqStart > total) return { emails: [], total };

    const clampedEnd = Math.min(seqEnd, total);
    const emails: EmailSummary[] = [];
    for await (const msg of client.fetch(`${seqStart}:${clampedEnd}`, { envelope: true, uid: true })) {
      const addr = msg.envelope?.from?.[0];
      const from = addr
        ? `${addr.name ? addr.name + " " : ""}<${addr.address ?? "unknown"}>`
        : "unknown";
      emails.push({
        uid: msg.uid,
        from,
        subject: msg.envelope?.subject || "(no subject)",
        date: msg.envelope?.date?.toISOString().split("T")[0] ?? "unknown",
      });
    }

    return { emails, total };
  } finally {
    await client.logout();
  }
}

export async function deleteEmailsByUid(uids: number[]): Promise<number> {
  if (uids.length === 0) return 0;
  const client = createImapClient();
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    await client.messageDelete(uids, { uid: true });
    return uids.length;
  } finally {
    await client.logout();
  }
}

export async function deleteByFrom(address: string): Promise<number> {
  const emailMatch = address.match(/<([^>]+)>/);
  const searchAddr = emailMatch ? emailMatch[1] : address;
  const client = createImapClient();
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    const result = await client.search({ from: searchAddr }, { uid: true });
    const uids = Array.isArray(result) ? result : [];
    if (uids.length === 0) return 0;
    await client.messageDelete(uids, { uid: true });
    return uids.length;
  } finally {
    await client.logout();
  }
}

export async function fetchUnsubscribeHeaders(
  uids: number[]
): Promise<Map<number, { listUnsubscribe: string; listUnsubscribePost?: string }>> {
  if (uids.length === 0) return new Map();
  const client = createImapClient();
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");

    // IMAP SEARCH for emails with a List-Unsubscribe header — same technique as deleteByCategory,
    // proven reliable with Yahoo Mail. Intersect with our delete UIDs to avoid fetching headers
    // for everything in the inbox.
    const withUnsub = (await client.search(
      { header: { "List-Unsubscribe": "" } },
      { uid: true }
    )) as number[];
    const targetUids = uids.filter(uid => withUnsub.includes(uid));
    if (targetUids.length === 0) return new Map();

    const result = new Map<number, { listUnsubscribe: string; listUnsubscribePost?: string }>();
    for await (const msg of client.fetch(targetUids, {
      uid: true,
      headers: ["list-unsubscribe", "list-unsubscribe-post"],
    })) {
      const raw = msg.headers ? (msg.headers as Buffer).toString() : "";
      const listUnsubscribe = raw.match(/^list-unsubscribe:\s*(.+)$/im)?.[1]?.trim();
      if (listUnsubscribe) {
        result.set(msg.uid, {
          listUnsubscribe,
          listUnsubscribePost: raw.match(/^list-unsubscribe-post:\s*(.+)$/im)?.[1]?.trim(),
        });
      }
    }
    return result;
  } finally {
    await client.logout();
  }
}

// Categories where RFC 2369 List-Unsubscribe header is a reliable server-side signal
const BULK_CATEGORIES = new Set([
  "promotional",
  "newsletter",
  "social",
  "travel",
  "food",
  "automated",
  "spam",
]);

export async function deleteByCategory(category: string, localUids: number[]): Promise<number> {
  const client = createImapClient();
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");

    let serverUids: number[] = [];
    if (BULK_CATEGORIES.has(category)) {
      const result = await client.search({ header: { "List-Unsubscribe": "" } }, { uid: true });
      serverUids = Array.isArray(result) ? result : [];
    }

    const allUids = [...new Set([...serverUids, ...Array.from(localUids)])];
    if (allUids.length === 0) return 0;
    await client.messageDelete(allUids, { uid: true });
    return allUids.length;
  } finally {
    await client.logout();
  }
}
