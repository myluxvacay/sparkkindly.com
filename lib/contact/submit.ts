import type { Queryable } from '@/lib/db';
import { createLimiter } from '@/lib/agents/rate-limit';

export const CONTACT_TOPICS = [
  ['general', 'General question'],
  ['suggest', 'Suggest a topic'],
  ['error', 'Report an error'],
  ['sponsorship', 'Sponsorship'],
  ['other', 'Other'],
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number][0];

const TOPIC_VALUES: readonly string[] = CONTACT_TOPICS.map(([value]) => value);
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 2000;
// The same address shape the site accepts for the published contact address (lib/config.ts).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The form takes plain text only. Angle brackets are markup, and nothing here ever renders a sender's HTML.
const MARKUP = /[<>]/;

export type ContactInput = { name: unknown; email: unknown; topic: unknown; message: unknown; website: unknown };
export type StoredContact = { name: string; email: string; topic: ContactTopic; message: string };
export type ContactResult =
  | { status: 'stored'; contact: StoredContact }
  | { status: 'dropped' }
  | { status: 'invalid' };

// Stores one visitor message from the Contact page. The sender's email is kept so the owner can reply — that is
// the point of this form, and the privacy guide says so. `website` is a honeypot field hidden from people; a bot
// that fills it is reported as 'dropped': the caller answers as if it were stored and nothing is written or sent.
export async function submitContactMessage(db: Queryable, input: ContactInput): Promise<ContactResult> {
  if (typeof input.website === 'string' ? input.website !== '' : input.website != null) return { status: 'dropped' };
  const name = input.name == null ? '' : input.name;
  const { email, topic, message } = input;
  if (typeof name !== 'string' || name.trim().length > MAX_NAME || MARKUP.test(name)) return { status: 'invalid' };
  if (typeof email !== 'string' || email.trim().length > MAX_EMAIL || !EMAIL_RE.test(email.trim())) return { status: 'invalid' };
  if (typeof topic !== 'string' || !TOPIC_VALUES.includes(topic)) return { status: 'invalid' };
  if (typeof message !== 'string' || message.trim().length < 1 || message.trim().length > MAX_MESSAGE || MARKUP.test(message)) {
    return { status: 'invalid' };
  }
  const contact: StoredContact = { name: name.trim(), email: email.trim(), topic: topic as ContactTopic, message: message.trim() };
  await db.query('INSERT INTO contact_messages (name, email, topic, message) VALUES ($1, $2, $3, $4)', [
    contact.name,
    contact.email,
    contact.topic,
    contact.message,
  ]);
  return { status: 'stored', contact };
}

export type RateResult = { ok: true } | { ok: false; retryAfter: number };

// 5 messages an hour per client and 200 an hour overall — the same limits as problem reports. createLimiter counts
// per minute, so it is given a clock that runs 60x slow: "5 per minute" there is 5 per hour here. Retry-After is
// the time for one token to come back.
export function createContactLimits(clock: () => number = Date.now) {
  const slow = () => clock() / 60;
  const perClient = createLimiter({ perMinute: 5, now: slow });
  const overall = createLimiter({ perMinute: 200, now: slow });
  return (clientKey: string): RateResult => {
    if (!perClient(clientKey)) return { ok: false, retryAfter: 3600 / 5 };
    if (!overall('all')) return { ok: false, retryAfter: Math.ceil(3600 / 200) };
    return { ok: true };
  };
}

// One instance per process (the limiter lives in memory).
export const checkContactRate = createContactLimits();
