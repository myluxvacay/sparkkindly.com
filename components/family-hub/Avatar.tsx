// Kid-profile avatars: built-in illustrated ids only (scope §3 — never a photo upload).
// Simple inline SVG faces on the profile colour; the same set is offered by the picker.
import { COLOUR_HEX, isColour, type HubColour } from '@/lib/family-hub/rules';

const EARS: Record<string, React.ReactNode> = {
  mango: (
    <>
      <path d="M22 30 L26 14 L38 24 Z" fill="#fff" opacity="0.9" />
      <path d="M58 30 L54 14 L42 24 Z" fill="#fff" opacity="0.9" />
    </>
  ),
  dog: (
    <>
      <ellipse cx="18" cy="34" rx="7" ry="12" fill="#fff" opacity="0.9" />
      <ellipse cx="62" cy="34" rx="7" ry="12" fill="#fff" opacity="0.9" />
    </>
  ),
  owl: (
    <>
      <circle cx="30" cy="36" r="8" fill="#fff" />
      <circle cx="50" cy="36" r="8" fill="#fff" />
    </>
  ),
  fox: (
    <>
      <path d="M20 26 L24 10 L40 22 Z" fill="#fff" opacity="0.9" />
      <path d="M60 26 L56 10 L40 22 Z" fill="#fff" opacity="0.9" />
    </>
  ),
  bear: (
    <>
      <circle cx="22" cy="20" r="8" fill="#fff" opacity="0.9" />
      <circle cx="58" cy="20" r="8" fill="#fff" opacity="0.9" />
    </>
  ),
  bunny: (
    <>
      <ellipse cx="30" cy="14" rx="5" ry="10" fill="#fff" opacity="0.9" />
      <ellipse cx="50" cy="14" rx="5" ry="10" fill="#fff" opacity="0.9" />
    </>
  ),
};

export default function Avatar({ avatarId, colour, name, size = 40 }: { avatarId: string; colour: string; name: string; size?: number }) {
  const hex = COLOUR_HEX[(isColour(colour) ? colour : 'purple') as HubColour];
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" role="img" aria-label={`${name}'s avatar`} style={{ borderRadius: '50%', background: hex, flexShrink: 0 }}>
      {avatarId === 'spark' ? (
        <path d="M40 66 C20 52 14 40 14 30 C14 20 21 14 29 14 C35 14 39 17 40 21 C41 17 45 14 51 14 C59 14 66 20 66 30 C66 40 60 52 40 66 Z" fill="#fff" />
      ) : avatarId === 'rocket' ? (
        <>
          <path d="M40 8 C50 18 54 30 54 42 L26 42 C26 30 30 18 40 8 Z" fill="#fff" />
          <circle cx="40" cy="28" r="6" fill={hex} />
          <path d="M32 52 L40 66 L48 52 Z" fill="#ffd166" />
        </>
      ) : (
        <>
          {EARS[avatarId] ?? null}
          <circle cx="40" cy="44" r="20" fill="#fff" opacity="0.95" />
          <circle cx="33" cy="42" r="2.6" fill="#222" />
          <circle cx="47" cy="42" r="2.6" fill="#222" />
          <path d="M34 50 Q40 55 46 50" stroke="#222" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
