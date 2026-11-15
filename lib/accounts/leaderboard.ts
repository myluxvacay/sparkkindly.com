// Public leaderboard profile (Project 4.11, ADR 0004): the holder's opt-in, public display name and chosen avatar.
// Stored on the accounts row (migration 035). The age capability (public_leaderboard, 16+) is checked by the web
// layer before a save and again by the public read, so this module only validates and stores what the holder
// chose: a name of 1 to 30 characters with no blocked word, and an avatar from the built-in set. Opting out keeps
// the name and avatar for next time; it only turns the flag off. No Next.js imports.
// Verified by tests/unit/account-leaderboard.test.ts.
import type { Db } from '@/lib/db';
import { findBlockedWord } from '@/lib/items/blocked';
import { isAvatarKey, DEFAULT_AVATAR, type AvatarKey } from '@/lib/avatars';
import { isUuid } from './pin';

export type LeaderboardProfile = { optIn: boolean; publicName: string | null; avatarKey: AvatarKey | null };

export async function getLeaderboardProfile(db: Db, accountId: string): Promise<LeaderboardProfile | null> {
  if (!isUuid(accountId)) {
    return null;
  }
  const r = await db.query<{ opt_in: boolean; public_name: string | null; avatar_key: string | null }>(
    'SELECT leaderboard_opt_in AS opt_in, public_name, avatar_key FROM accounts WHERE id = $1',
    [accountId],
  );
  const row = r.rows[0];
  if (!row) {
    return null;
  }
  return {
    optIn: row.opt_in,
    publicName: row.public_name,
    avatarKey: isAvatarKey(row.avatar_key) ? row.avatar_key : null,
  };
}

export type SaveLeaderboardResult = 'ok' | 'invalid' | 'blocked';

// The holder's chosen public name, cleaned the way other names on the site are: trimmed, single-spaced, 1 to 30
// characters. Returns null when the shape is wrong; blocked words are reported separately by the caller.
export function cleanPublicName(v: unknown): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const name = v.replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= 30 ? name : null;
}

export async function saveLeaderboardProfile(
  db: Db,
  accountId: string,
  input: { optIn: unknown; publicName?: unknown; avatarKey?: unknown },
): Promise<SaveLeaderboardResult> {
  if (!isUuid(accountId) || typeof input.optIn !== 'boolean') {
    return 'invalid';
  }
  if (!input.optIn) {
    const r = await db.query('UPDATE accounts SET leaderboard_opt_in = false WHERE id = $1', [accountId]);
    return (r.rowCount ?? 0) > 0 ? 'ok' : 'invalid';
  }
  const name = cleanPublicName(input.publicName);
  if (!name) {
    return 'invalid';
  }
  if (findBlockedWord(name)) {
    return 'blocked';
  }
  const avatar: AvatarKey = isAvatarKey(input.avatarKey) ? input.avatarKey : DEFAULT_AVATAR;
  const r = await db.query(
    'UPDATE accounts SET leaderboard_opt_in = true, public_name = $2, avatar_key = $3 WHERE id = $1',
    [accountId, name, avatar],
  );
  return (r.rowCount ?? 0) > 0 ? 'ok' : 'invalid';
}
