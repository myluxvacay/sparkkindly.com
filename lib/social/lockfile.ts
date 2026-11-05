// An exclusive lock file holding a random nonce (5B review L1), for the upload lock and the token store lock. Created
// with O_EXCL; a lock older than `staleMs` is taken over; release removes the file only while it still holds this
// holder's nonce, so a holder that outlived its lock never deletes the one that replaced it. No Next.js imports.
// Verified by tests/unit/social-video-upload.test.ts and social-token-store.test.ts.
import { randomBytes } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';

// The release function, or null while another holder has it. Other errors (a missing folder) are thrown.
export async function acquireLock(file: string, staleMs: number): Promise<(() => Promise<void>) | null> {
  const nonce = randomBytes(16).toString('hex');
  for (let i = 0; i < 2; i++) {
    try {
      await writeFile(file, nonce, { flag: 'wx', mode: 0o600 });
      return async () => {
        if ((await readFile(file, 'utf8').catch(() => '')) === nonce) await rm(file, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const s = await stat(file).catch(() => null);
      if (s && Date.now() - s.mtimeMs < staleMs) return null;
      await rm(file, { force: true });
    }
  }
  return null;
}
