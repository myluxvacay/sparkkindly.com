// The built-in avatar set for the public leaderboard (Project 4.11, ADR 0004). Avatars are chosen, never uploaded:
// each key names one illustrated SVG under public/avatars/, served first-party like every other site asset. The
// label describes the picture for the settings picker; on the board the image is decorative beside the member's
// public name, so it carries no alt text there.
export const AVATARS = [
  { key: 'sunny', label: 'Sunny — smiling face, curly hair, gold background' },
  { key: 'wave', label: 'Wave — wavy teal hair, blue background' },
  { key: 'star', label: 'Star — glasses and a grin, coral background' },
  { key: 'leaf', label: 'Leaf — headscarf, green background' },
  { key: 'comet', label: 'Comet — spiky hair, plum background' },
  { key: 'bloom', label: 'Bloom — long hair with a flower, pink background' },
  { key: 'orbit', label: 'Orbit — short hair and freckles, sky background' },
  { key: 'spark', label: 'Spark — the smiling star mascot, cream background' },
] as const;

export type AvatarKey = (typeof AVATARS)[number]['key'];

export const DEFAULT_AVATAR: AvatarKey = 'spark';

export const isAvatarKey = (v: unknown): v is AvatarKey =>
  typeof v === 'string' && AVATARS.some((a) => a.key === v);

export const avatarSrc = (key: string): string => `/avatars/${key}.svg`;
