// Web Push configuration (Phase 2.5, 27 Nov 2026). The VAPID keys live ONLY in the
// server env files (/opt/sparkkindly/shared/*.env) — never in the repo. Until the owner
// pastes them in, every push path in lib/family-hub/push.ts is a silent no-op and the
// Hub shows "Notifications aren't switched on yet" instead of a subscribe button.
// Kept dependency-free so server components can read the flags without pulling the
// web-push sender into their module graph.
export type PushConfig = { publicKey: string; privateKey: string; subject: string };

export function pushConfig(): PushConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  const subject = process.env.VAPID_SUBJECT ?? '';
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export const pushEnabled = (): boolean => pushConfig() !== null;

export const vapidPublicKey = (): string | null => pushConfig()?.publicKey ?? null;
