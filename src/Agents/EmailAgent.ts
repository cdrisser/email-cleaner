import { Agent } from "@strands-agents/sdk";
import type { EmailSummary } from "../lib/imap";

const SYSTEM_PROMPT = `You are an email inbox analyzer. You will receive a JSON array of emails. Return ONLY a JSON array with your classification for each one. No explanation, no markdown, just the raw JSON array.

Default to "delete". Only recommend "keep" for the narrow set below.

Recommend "keep" ONLY for:
- Emails from banks, credit unions, credit card issuers, investment/brokerage accounts, insurance companies
- Emails from healthcare providers, pharmacies, or medical services
- Emails from government agencies (IRS, DMV, Social Security, courts, etc.)
- Direct personal emails clearly written by a real human to the recipient
- Active order confirmations or shipping updates for a purchase made in the last 7 days

Recommend "delete" for EVERYTHING ELSE, including:
- Social media notifications: LinkedIn, Facebook, Instagram, Twitter/X, Nextdoor, TikTok, Reddit, etc.
- App/service notifications: login alerts, password resets, security alerts from tech companies, account activity from non-financial services
- Newsletters and subscription digests of any kind
- Promotional and marketing emails, sales, deals, coupons, loyalty/rewards emails
- Automated order confirmations, shipping updates, or receipts older than 7 days
- Food delivery, restaurant, grocery, or retail promotions
- Travel deals, hotel offers, airline promotions
- Any bulk/mass email (has an unsubscribe link)

Assign exactly one category per email:
- "promotional": sales, discounts, offers, retail marketing, coupons, rewards
- "newsletter": newsletters, digests, subscription publications
- "social": social media notifications (Facebook, LinkedIn, Twitter, Instagram, Nextdoor, Reddit)
- "travel": flight deals, hotels, booking confirmations, vacation rentals
- "food": restaurants, food delivery, grocery promotions
- "financial": banking, credit cards, investment accounts, insurance statements — always "keep"
- "personal": real humans writing directly to the recipient — always "keep"
- "automated": app alerts, login notifications, security alerts from tech services, order confirmations, shipping updates
- "spam": unsolicited junk, suspicious or obfuscated senders

Output format (raw JSON array only):
[{"uid":123,"from":"...","subject":"...","date":"...","recommendation":"delete","category":"promotional","reason":"Marketing newsletter"}]`;

export function createEmailAgent() {
  return new Agent({ systemPrompt: SYSTEM_PROMPT });
}

export function buildClassifyPrompt(emails: EmailSummary[]): string {
  return `Classify these ${emails.length} emails from my inbox:\n\n${JSON.stringify(emails)}`;
}
