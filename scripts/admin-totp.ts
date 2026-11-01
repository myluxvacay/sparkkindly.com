// Enrols (or replaces) the authenticator for an admin address and prints its secret ONCE, as an otpauth URI to paste
// or turn into a QR code locally. There is deliberately no web page for this: enrolling needs database access, so
// someone who only controls the mailbox can never add a second factor.
// Usage: npm run admin:totp -- <email>    (reads DATABASE_URL from .env.local or the environment)
// Verified by: tests/unit/admin-sessions.test.ts for the code check; by hand per docs/OPERATIONS.md for this script.
import { getDb, getPool } from '../lib/db';
import { isAllowed } from '../lib/admin/sessions';
import { newTotpSecret, otpauthUri } from '../lib/admin/totp';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: rely on the real environment
}

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
  console.error('Usage: npm run admin:totp -- <email>');
  process.exit(2);
}

try {
  const db = getDb();
  const target = (await db.query<{ db: string }>('SELECT current_database() AS db')).rows[0].db;
  const secret = newTotpSecret();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO admin_users (email, totp_secret) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET totp_secret = EXCLUDED.totp_secret, totp_last_step = 0`,
      [email, secret],
    );
    // Any session from the old authenticator ends with it.
    await tx.query('DELETE FROM admin_sessions WHERE email = $1', [email]);
    await tx.query("INSERT INTO audit_log (actor, action, target) VALUES ('cli', 'totp_enrolled', $1)", [email]);
  });
  console.log(`Authenticator enrolled for ${email} in database ${target}.`);
  if (!isAllowed(email, process.env)) {
    console.log('Note: this address is not in the local ADMIN_EMAILS; it must be in the server env file to sign in.');
  }
  console.log('Add this to your authenticator app now (shown once, not stored anywhere else readable):');
  console.log(otpauthUri(email, secret));
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
} finally {
  await getPool().end();
}
