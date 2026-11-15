import { avatarSrc, isAvatarKey, DEFAULT_AVATAR } from '@/lib/avatars';

// A member's chosen avatar from the built-in set (lib/avatars.ts). Decorative by design: it always sits beside
// the member's public name as visible text, so the image itself carries alt="". An unset or unknown key falls
// back to the default mascot rather than a broken image.
export default function Avatar({ avatarKey, size = 44 }: { avatarKey?: string | null; size?: number }) {
  const key = isAvatarKey(avatarKey) ? avatarKey : DEFAULT_AVATAR;
  return <img className="avatar" src={avatarSrc(key)} alt="" width={size} height={size} loading="lazy" />;
}
