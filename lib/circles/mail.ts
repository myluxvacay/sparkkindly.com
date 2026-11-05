// Circle mail selection and templates (plan 4D, spec Project 4 "Member notifications"): which circles are due for the
// set-ready email (after 07:00 in the circle's zone), the weekly summary (from Monday 08:00 local, caught up later in
// the week if missed) and re-score notices (notices of the last day), and who gets each: current account members
// (never a child profile), verified, not consent-pending, with the matching preference on, re-read in the query that
// picks them. Open, visible circles with at least one member besides the owner only. The text never names an item, an
// answer or another member: the daily and re-score mails name the circle only; the weekly one gives the recipient's own
// rows (account and own child profiles), the circle total and the member count. Every mail carries the 3E unsubscribe
// link and RFC 8058 headers; without a usable UNSUBSCRIBE_SECRET nothing is selected. Each batch is one (circle, kind,
// period) that lib/jobs/circle-mail.ts claims before sending; a batch may hold no mail (claimed so it is not re-picked).
// No Next.js imports. Verified by tests/unit/circles-mail.test.ts.
import type { Db, Queryable } from '@/lib/db';
import { unsubscribeToken, type UnsubscribeKind } from '@/lib/accounts/unsubscribe';
import { circleAudiences, getOrCreateDailySet } from './daily-set';
import { memberCount } from './repo';
import { COUNTS, rankWithTies } from './scores';
import { pointsCorrect } from './points';

export type MailKind = 'daily' | 'weekly' | 'rescore';
export type Claim = { circleId: string; kind: MailKind; period: string };
export type Outgoing = { to: string; subject: string; text: string; headers: Record<string, string>; claim: Claim };
export type MailBatch = { claim: Claim; mails: Outgoing[] };
export type Cap = { mails: number; circles: number };
export type Links = { base: string; secret: string };
type Text = { subject: string; text: string };
export type WeekRow = { name: string | null; rank: number; points: number };

export const dailyEmail = (circleName: string, url: string): Text => ({
  subject: `Your SparkKindly set for ${circleName} is ready`,
  text: [`Today's set for your circle "${circleName}" is ready.`, '', 'Play it here:', url].join('\n'),
});

export const rescoreEmail = (circleName: string, url: string): Text => ({
  subject: `A score in ${circleName} was corrected`,
  text: [
    `An answer in a recent set for your circle "${circleName}" was corrected, and the scores were re-marked.`,
    '',
    'See the circle:',
    url,
  ].join('\n'),
});

// rows: the recipient's own rows; name null is the recipient, otherwise one of their own child profiles.
export function weeklyEmail(circleName: string, url: string, s: { rows: WeekRow[]; total: number; members: number }): Text {
  const line = (r: WeekRow) => `${r.name ?? 'You'}: rank ${r.rank}, ${r.points} points`;
  return {
    subject: `Your week in ${circleName}`,
    text: [
      `Last week in your circle "${circleName}":`,
      '',
      ...s.rows.map(line),
      '',
      `Circle total: ${s.total} points`,
      `Members: ${s.members}`,
      '',
      'See the scores:',
      url,
    ].join('\n'),
  };
}

type Due = { id: string; name: string; slug: string; time_zone: string; period: string };
type Recipient = { id: string; email: string };

const PREF: Record<MailKind, { column: string; kind: UnsubscribeKind }> = {
  daily: { column: 'notify_daily_set', kind: 'daily_set' },
  weekly: { column: 'notify_weekly_circle', kind: 'weekly_circle' },
  rescore: { column: 'notify_daily_set', kind: 'daily_set' },
};

const OPEN_WITH_MEMBERS = `c.status = 'open' AND c.hidden_at IS NULL
  AND EXISTS (SELECT 1 FROM circle_members m WHERE m.circle_id = c.id AND m.left_at IS NULL AND m.role = 'member')`;
const UNCLAIMED = (kind: MailKind, period: string) =>
  `NOT EXISTS (SELECT 1 FROM circle_mail_log l WHERE l.circle_id = c.id AND l.kind = '${kind}' AND l.period = ${period})`;

// $1 clock, $2 limit. z.t is the circle's local time.
const dueSql = (kind: MailKind, period: string, ready: string) => `
  SELECT c.id, c.name, c.slug, c.time_zone, ${period} AS period
  FROM circles c CROSS JOIN LATERAL (SELECT $1::timestamptz AT TIME ZONE c.time_zone AS t) z
  WHERE ${OPEN_WITH_MEMBERS} AND ${ready} AND ${UNCLAIMED(kind, period)}
  ORDER BY c.created_at, c.id LIMIT $2`;

const DUE_DAILY = dueSql('daily', "to_char(z.t, 'YYYY-MM-DD')", 'extract(hour FROM z.t) >= 7');
const DUE_WEEKLY = dueSql(
  'weekly',
  "to_char(date_trunc('week', z.t), 'YYYY-MM-DD')",
  "z.t >= date_trunc('week', z.t) + interval '8 hours'",
);
const DUE_RESCORE = `
  SELECT c.id, c.name, c.slug, c.time_zone, n.id::text AS period
  FROM circle_notices n JOIN circles c ON c.id = n.circle_id
  WHERE n.created_at > $1::timestamptz - interval '1 day' AND n.created_at <= $1::timestamptz
    AND ${OPEN_WITH_MEMBERS} AND ${UNCLAIMED('rescore', 'n.id::text')}
  ORDER BY n.id LIMIT $2`;

async function recipients(q: Queryable, circleId: string, kind: MailKind): Promise<Recipient[]> {
  const r = await q.query<Recipient>(
    `SELECT a.id, a.email FROM circle_members m JOIN accounts a ON a.id = m.account_id
     WHERE m.circle_id = $1 AND m.profile_id IS NULL AND m.left_at IS NULL
       AND a.verified_at IS NOT NULL AND a.consent_state <> 'pending' AND a.${PREF[kind].column}
     ORDER BY m.joined_at, a.id`,
    [circleId],
  );
  return r.rows;
}

function outgoing(to: Recipient, mail: Text, claim: Claim, links: Links): Outgoing {
  const t = unsubscribeToken(links.secret, to.id, PREF[claim.kind].kind)!;
  return {
    to: to.email,
    subject: mail.subject,
    text: `${mail.text}\n\nTo stop these emails, open this link:\n${links.base}/account/unsubscribe/?t=${t}`,
    headers: {
      'List-Unsubscribe': `<${links.base}/account/unsubscribe/confirm/?t=${t}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    claim,
  };
}

type Compose = (db: Db, c: Due, to: Recipient[], now: Date) => Promise<(Text | null)[]>;

// Whole circles only, until either cap is reached; nothing without a secret unsubscribe tokens can be minted with.
async function select(db: Db, now: Date, cap: Cap, links: Links, kind: MailKind, sql: string, compose: Compose) {
  if (cap.circles <= 0 || cap.mails <= 0 || !unsubscribeToken(links.secret, '00000000-0000-4000-8000-000000000000', 'daily_set')) {
    return [];
  }
  const due = await db.query<Due>(sql, [now.toISOString(), cap.circles]);
  const out: MailBatch[] = [];
  let mails = 0;
  for (const c of due.rows) {
    const claim = { circleId: c.id, kind, period: c.period };
    const to = await recipients(db, c.id, kind);
    const texts = to.length ? await compose(db, c, to, now) : [];
    const batch = to.flatMap((r, i) => (texts[i] ? [outgoing(r, texts[i]!, claim, links)] : []));
    if (mails + batch.length > cap.mails) break;
    mails += batch.length;
    out.push({ claim, mails: batch });
  }
  return out;
}

// The set is made here if nobody opened it yet; an empty set means nothing is ready, so no mail.
export const dailyMailFor = (db: Db, now: Date, cap: Cap, links: Links) =>
  select(db, now, cap, links, 'daily', DUE_DAILY, async (d, c, to, n) => {
    const ready = (await getOrCreateDailySet(d, c.id, n)).length > 0;
    return to.map(() => (ready ? dailyEmail(c.name, `${links.base}/circles/${c.slug}/set/`) : null));
  });

export const rescoreMailFor = (db: Db, now: Date, cap: Cap, links: Links) =>
  select(db, now, cap, links, 'rescore', DUE_RESCORE, async (_d, c, to) =>
    to.map(() => rescoreEmail(c.name, `${links.base}/circles/${c.slug}/`)),
  );

export const weeklyMailFor = (db: Db, now: Date, cap: Cap, links: Links) =>
  select(db, now, cap, links, 'weekly', DUE_WEEKLY, async (d, c, to, n) => {
    const s = await weekStanding(d, c, n);
    return to.map((r) => weeklyEmail(c.name, `${links.base}/circles/${c.slug}/scores/`, s(r.id)));
  });

type CountRow = { name: string; former: boolean; aid: string; pid: string | null; week: number };

// Last week's board (the week before the period's Monday), as the scores page would rank it, with a function giving one
// account's own current rows.
async function weekStanding(db: Db, c: Due, now: Date) {
  const sunday = new Date(Date.parse(`${c.period}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const audiences = [...(await circleAudiences(db, c.id))];
  const rows = (await db.query<CountRow>(COUNTS, [now, audiences, c.id, c.time_zone, sunday, null, null])).rows;
  const points = await pointsCorrect(db);
  const members = await memberCount(db, c.id);
  const listed = rows.filter((r) => !r.former || r.week > 0);
  const ranks = rankWithTies(listed.map((r) => r.week));
  const total = listed.reduce((sum, r) => sum + r.week * points, 0);
  return (accountId: string) => ({
    rows: listed
      .flatMap((r, i) => (r.aid === accountId && !r.former ? [{ name: r.pid ? r.name : null, rank: ranks[i], points: r.week * points }] : []))
      .sort((a, b) => Number(a.name !== null) - Number(b.name !== null)),
    total,
    members,
  });
}
