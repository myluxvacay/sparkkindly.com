import { createHash, randomBytes } from 'node:crypto';

// Shared by admin and account sign-in: tokens are random, sent to the client once, and stored only as sha256 hashes.
export const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');
