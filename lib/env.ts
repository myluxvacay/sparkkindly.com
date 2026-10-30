// Environment variables the server needs at runtime. /api/health reports any that are missing,
// so a deploy with an incomplete env file fails its health check instead of failing later.
export const requiredEnv = ['DATABASE_URL', 'MAILERSEND_API_TOKEN', 'MAIL_FROM', 'SITE_RELEASE'] as const;

// A plain record rather than NodeJS.ProcessEnv: Next.js augments ProcessEnv to require NODE_ENV,
// which would force every caller and test to supply it. process.env is assignable to this type.
export type EnvLike = Record<string, string | undefined>;

export function missingEnv(env: EnvLike): string[] {
  return requiredEnv.filter((name) => !env[name]);
}
