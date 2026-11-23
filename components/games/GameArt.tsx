// Original in-repo SVG artwork for the visual games (content/games; scenes use SceneArt.tsx). Flags are public domain;
// their colours and layouts follow the real designs, simplified for small sizes (star counts and fine arms
// are not exact). Everything else is a simple original illustration drawn for SparkKindly.
// No external images, no hotlinks, no stock.

const F = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <svg viewBox="0 0 120 84" role="img" aria-label={label} className="game-art-flag">
    <defs>
      <clipPath id={`fc-${label.replace(/\W+/g, '')}`}>
        <rect x="2" y="2" width="116" height="80" rx="8" />
      </clipPath>
    </defs>
    <g clipPath={`url(#fc-${label.replace(/\W+/g, '')})`}>{children}</g>
    <rect x="2" y="2" width="116" height="80" rx="8" fill="none" stroke="#00000022" />
  </svg>
);

const P = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <svg viewBox="0 0 120 120" role="img" aria-label={label} className="game-art-picture">
    {children}
  </svg>
);

const mapleLeaf = (
  <path
    d="M60 18l6 12 10-6-4 12 13-3-8 10 11 4-11 6 5 11-12-4-4 12-6-14-6 14-4-12-12 4 5-11-11-6 11-4-8-10 13 3-4-12 10 6z"
    fill="#d80621"
  />
);

export default function GameArt({ art, alt }: { art: string; alt: string }) {
  switch (art) {
    // ---- Flags (public domain designs) ----
    case 'flag-jp':
      return <F label={alt}><rect width="120" height="84" fill="#fff" /><circle cx="60" cy="42" r="16" fill="#bc002d" /></F>;
    case 'flag-ca':
      return <F label={alt}><rect width="120" height="84" fill="#fff" /><rect width="30" height="84" fill="#d80621" /><rect x="90" width="30" height="84" fill="#d80621" />{mapleLeaf}</F>;
    case 'flag-ch':
      // Switzerland's flag is square (1:1) — it keeps its own frame instead of the shared 120x84 one.
      return (
        <svg viewBox="0 0 84 84" role="img" aria-label={alt} className="game-art-flag">
          <rect x="2" y="2" width="80" height="80" rx="8" fill="#da291c" />
          <rect x="34" y="20" width="16" height="44" fill="#fff" /><rect x="20" y="34" width="44" height="16" fill="#fff" />
          <rect x="2" y="2" width="80" height="80" rx="8" fill="none" stroke="#00000022" />
        </svg>
      );
    case 'flag-kr':
      return (
        <F label={alt}>
          <rect width="120" height="84" fill="#fff" />
          <path d="M38 42a22 22 0 0 1 44 0a11 11 0 0 1-22 0a11 11 0 0 0-22 0z" fill="#cd2e3a" />
          <path d="M38 42a22 22 0 0 0 44 0a11 11 0 0 0-22 0a11 11 0 0 1-22 0z" fill="#0047a0" />
          <g stroke="#000" strokeWidth="4"><path d="M14 12l14 6M14 22l14 6M14 32l14 6" /><path d="M92 12l14 6M92 32l14 6" /><path d="M14 46l14 6M14 66l14 6" /><path d="M92 46l14 6M92 56l14 6M92 66l14 6" /></g>
        </F>
      );
    case 'flag-fr':
      return <F label={alt}><rect width="40" height="84" fill="#0055a4" /><rect x="40" width="40" height="84" fill="#fff" /><rect x="80" width="40" height="84" fill="#ef4135" /></F>;
    case 'flag-it':
      return <F label={alt}><rect width="40" height="84" fill="#009246" /><rect x="40" width="40" height="84" fill="#fff" /><rect x="80" width="40" height="84" fill="#ce2b37" /></F>;
    case 'flag-es':
      return <F label={alt}><rect width="120" height="84" fill="#aa151b" /><rect y="21" width="120" height="42" fill="#f1bf00" /></F>;
    case 'flag-de':
      return <F label={alt}><rect width="120" height="28" fill="#000" /><rect y="28" width="120" height="28" fill="#dd0000" /><rect y="56" width="120" height="28" fill="#ffce00" /></F>;
    case 'flag-ar':
      return <F label={alt}><rect width="120" height="28" fill="#74acdf" /><rect y="28" width="120" height="28" fill="#fff" /><rect y="56" width="120" height="28" fill="#74acdf" /><circle cx="60" cy="42" r="8" fill="#f6b40e" /></F>;
    case 'flag-mx':
      return <F label={alt}><rect width="40" height="84" fill="#006847" /><rect x="40" width="40" height="84" fill="#fff" /><rect x="80" width="40" height="84" fill="#ce1126" /><circle cx="60" cy="42" r="7" fill="#8a7d3b" /></F>;
    case 'flag-br':
      return (
        <F label={alt}>
          <rect width="120" height="84" fill="#009c3b" />
          <path d="M60 10L110 42 60 74 10 42z" fill="#ffdf00" />
          <circle cx="60" cy="42" r="15" fill="#002776" />
          <path d="M46 36a30 30 0 0 0 28 12" stroke="#fff" strokeWidth="3" fill="none" />
          <g fill="#fff"><circle cx="53" cy="38" r="1.6" /><circle cx="63" cy="34" r="1.6" /><circle cx="68" cy="44" r="1.6" /><circle cx="57" cy="49" r="1.6" /><circle cx="65" cy="52" r="1.3" /></g>
        </F>
      );
    case 'flag-pt':
      return <F label={alt}><rect width="48" height="84" fill="#046a38" /><rect x="48" width="72" height="84" fill="#da291c" /><circle cx="48" cy="42" r="13" fill="#ffe900" stroke="#00000033" /></F>;
    case 'flag-us':
      return (
        <F label={alt}>
          <rect width="120" height="84" fill="#fff" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (<rect key={i} y={i * 12.9} width="120" height="6.5" fill="#b22234" />))}
          <rect width="52" height="45" fill="#3c3b6e" />
          <g fill="#fff">{[8, 20, 32].map((y) => [10, 22, 34, 46].map((x) => (<circle key={`${x}-${y}`} cx={x} cy={y} r="2.4" />)))}</g>
        </F>
      );
    case 'flag-gb':
      return (
        <F label={alt}>
          <rect width="120" height="84" fill="#012169" />
          <path d="M0 0L120 84M120 0L0 84" stroke="#fff" strokeWidth="14" />
          <path d="M0 0L120 84M120 0L0 84" stroke="#c8102e" strokeWidth="5" />
          <rect x="48" width="24" height="84" fill="#fff" /><rect y="30" width="120" height="24" fill="#fff" />
          <rect x="53" width="14" height="84" fill="#c8102e" /><rect y="35" width="120" height="14" fill="#c8102e" />
        </F>
      );
    case 'flag-au':
      return (
        <F label={alt}>
          <rect width="120" height="84" fill="#00247d" />
          <path d="M0 0L60 42M60 0L0 42" stroke="#fff" strokeWidth="8" />
          <path d="M0 0L60 42M60 0L0 42" stroke="#c8102e" strokeWidth="3" />
          <rect width="60" height="10" fill="#fff" /><rect x="25" width="10" height="42" fill="#fff" />
          <rect width="60" height="6" fill="#c8102e" /><rect x="27" width="6" height="42" fill="#c8102e" />
          <g fill="#fff"><circle cx="30" cy="62" r="4" /><circle cx="92" cy="18" r="3" /><circle cx="104" cy="38" r="3" /><circle cx="88" cy="52" r="3" /><circle cx="98" cy="66" r="3" /></g>
        </F>
      );
    // ---- Pictures ----
    case 'apple':
      return <P label={alt}><circle cx="60" cy="68" r="34" fill="#d43a2f" /><path d="M60 36q2-12 12-16" stroke="#7a4a21" strokeWidth="5" fill="none" /><path d="M62 24q16-8 22 4-12 10-22-4z" fill="#3f9e4d" /><ellipse cx="46" cy="56" rx="8" ry="12" fill="#ffffff55" /></P>;
    case 'banana':
      return <P label={alt}><path d="M28 30q6 52 62 62-4 10-16 8Q30 82 22 38z" fill="#f7d038" /><path d="M44 26q10 44 54 54-2 10-14 10Q44 76 36 34z" fill="#ffe066" /><rect x="34" y="18" width="12" height="12" rx="3" fill="#7a4a21" /></P>;
    case 'orange':
      return <P label={alt}><circle cx="60" cy="66" r="36" fill="#f58a1f" /><path d="M60 32q14-12 24-4-6 12-24 4z" fill="#3f9e4d" /><circle cx="60" cy="30" r="4" fill="#7a4a21" /><ellipse cx="46" cy="54" rx="8" ry="12" fill="#ffffff44" /></P>;
    case 'car':
      return <P label={alt}><path d="M18 72l8-22q3-8 12-8h44q9 0 13 8l7 22z" fill="#3b6fd4" /><rect x="14" y="70" width="92" height="16" rx="7" fill="#2c56a8" /><circle cx="36" cy="88" r="10" fill="#222" /><circle cx="84" cy="88" r="10" fill="#222" /><rect x="38" y="48" width="18" height="12" fill="#cfe6ff" /><rect x="62" y="48" width="18" height="12" fill="#cfe6ff" /></P>;
    case 'rose':
      return <P label={alt}><path d="M60 58v44" stroke="#3f9e4d" strokeWidth="6" /><path d="M60 82q-16-2-20-16 14 0 20 10zM60 90q16-2 20-16-14 0-20 10z" fill="#3f9e4d" /><circle cx="60" cy="38" r="20" fill="#c22f4d" /><path d="M48 34a12 12 0 1 1 18 12 9 9 0 1 1-12-11" stroke="#8f1f36" strokeWidth="4" fill="none" /></P>;
    case 'tulip':
      return <P label={alt}><path d="M60 58v44" stroke="#3f9e4d" strokeWidth="6" /><path d="M60 86q-18-4-22-20 16 2 22 14zM60 86q18-4 22-20-16 2-22 14z" fill="#3f9e4d" /><path d="M42 22q6 10 9 2 3 10 9 12 6-2 9-12 3 8 9-2 2 22-6 30H48q-8-8-6-30z" fill="#e56aa0" /></P>;
    case 'sunflower':
      return <P label={alt}><path d="M60 62v42" stroke="#3f9e4d" strokeWidth="6" /><path d="M60 88q-18-4-22-20 16 2 22 14z" fill="#3f9e4d" /><g fill="#f7b500">{[0, 40, 80, 120, 160, 200, 240, 280, 320].map((a) => (<ellipse key={a} cx="60" cy="20" rx="7" ry="13" transform={`rotate(${a} 60 42)`} />))}</g><circle cx="60" cy="42" r="15" fill="#7a4a21" /></P>;
    case 'mushroom':
      return <P label={alt}><path d="M22 58a38 30 0 0 1 76 0z" fill="#d43a2f" /><g fill="#fff"><circle cx="44" cy="42" r="6" /><circle cx="68" cy="34" r="5" /><circle cx="80" cy="48" r="4" /></g><path d="M50 58h20l4 34q-14 6-28 0z" fill="#f3e3c2" /></P>;
    case 'owl':
      return <P label={alt}><ellipse cx="60" cy="62" rx="30" ry="40" fill="#8a5a33" /><circle cx="47" cy="48" r="11" fill="#fff" /><circle cx="73" cy="48" r="11" fill="#fff" /><circle cx="47" cy="48" r="5" fill="#222" /><circle cx="73" cy="48" r="5" fill="#222" /><path d="M55 58h10l-5 7z" fill="#f7b500" /><path d="M40 24l8 10M80 24l-8 10" stroke="#8a5a33" strokeWidth="6" /></P>;
    case 'flamingo':
      return <P label={alt}><path d="M52 96V58" stroke="#e56aa0" strokeWidth="5" /><ellipse cx="58" cy="48" rx="26" ry="17" fill="#f28bb4" /><path d="M78 38q16-14 10-26-12 2-16 14z" fill="#f28bb4" /><circle cx="86" cy="18" r="8" fill="#f28bb4" /><path d="M92 20l12 4-11 5z" fill="#222" /></P>;
    case 'duck':
      return <P label={alt}><ellipse cx="58" cy="66" rx="32" ry="22" fill="#f7d038" /><circle cx="86" cy="42" r="15" fill="#f7d038" /><path d="M98 42l16 5-15 6z" fill="#f58a1f" /><circle cx="90" cy="39" r="3" fill="#222" /><path d="M34 60q14-12 26-4-12 10-26 4z" fill="#eab616" /></P>;
    case 'penguin':
      return <P label={alt}><ellipse cx="60" cy="60" rx="28" ry="40" fill="#22252d" /><ellipse cx="60" cy="68" rx="17" ry="28" fill="#fff" /><circle cx="51" cy="40" r="4" fill="#fff" /><circle cx="69" cy="40" r="4" fill="#fff" /><path d="M55 47h10l-5 8z" fill="#f58a1f" /><path d="M44 102h13M63 102h13" stroke="#f58a1f" strokeWidth="5" /></P>;
    // ---- Build-a-word pictures (wave 1, 21 Nov 2026): the objects the letter tiles spell ----
    case 'cat':
      return <P label={alt}><ellipse cx="60" cy="78" rx="34" ry="24" fill="#f58a1f" /><circle cx="60" cy="42" r="24" fill="#f58a1f" /><path d="M40 28l-4-16 16 8zM80 28l4-16-16 8z" fill="#f58a1f" /><path d="M43 27l-2-8 8 4zM77 27l2-8-8 4z" fill="#f28bb4" /><circle cx="51" cy="40" r="3.4" fill="#222" /><circle cx="69" cy="40" r="3.4" fill="#222" /><path d="M57 48h6l-3 4z" fill="#c22f4d" /><path d="M44 50h12M44 56l12-2M76 50H64M76 56l-12-2" stroke="#b35c10" strokeWidth="2.4" /><path d="M92 84q16-4 12-20" stroke="#f58a1f" strokeWidth="7" fill="none" strokeLinecap="round" /></P>;
    case 'dog':
      return <P label={alt}><ellipse cx="58" cy="80" rx="36" ry="22" fill="#b08954" /><circle cx="62" cy="44" r="25" fill="#b08954" /><path d="M40 30q-12 4-8 22 2 10 12 8 4-16-4-30zM86 28q12 2 10 20-2 10-12 10-4-16 2-30z" fill="#8a5a33" /><ellipse cx="62" cy="54" rx="11" ry="8" fill="#e8d5a8" /><circle cx="62" cy="50" r="4.4" fill="#222" /><circle cx="51" cy="40" r="3.4" fill="#222" /><circle cx="73" cy="40" r="3.4" fill="#222" /><path d="M58 62q4 4 8 0" stroke="#7a4a21" strokeWidth="2.6" fill="none" /><path d="M92 82q14-6 10-20" stroke="#b08954" strokeWidth="7" fill="none" strokeLinecap="round" /></P>;
    case 'pig':
      return <P label={alt}><ellipse cx="60" cy="72" rx="38" ry="30" fill="#f28bb4" /><path d="M34 50l-6-14 16 4zM86 50l6-14-16 4z" fill="#f28bb4" /><circle cx="60" cy="62" r="24" fill="#f6a8c6" /><ellipse cx="60" cy="66" rx="11" ry="8" fill="#ef7ba7" /><circle cx="56" cy="66" r="2.4" fill="#b83a6e" /><circle cx="64" cy="66" r="2.4" fill="#b83a6e" /><circle cx="49" cy="54" r="3.2" fill="#222" /><circle cx="71" cy="54" r="3.2" fill="#222" /><path d="M94 66q10-2 8-10" stroke="#ef7ba7" strokeWidth="4" fill="none" strokeLinecap="round" /></P>;
    case 'sun':
      return <P label={alt}><g stroke="#f7b500" strokeWidth="7" strokeLinecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const r = (a * Math.PI) / 180; return <line key={a} x1={60 + 40 * Math.cos(r)} y1={60 + 40 * Math.sin(r)} x2={60 + 52 * Math.cos(r)} y2={60 + 52 * Math.sin(r)} />; })}</g><circle cx="60" cy="60" r="34" fill="#ffd94d" /><circle cx="50" cy="56" r="3.4" fill="#8a5a00" /><circle cx="70" cy="56" r="3.4" fill="#8a5a00" /><path d="M50 68q10 8 20 0" stroke="#8a5a00" strokeWidth="3" fill="none" strokeLinecap="round" /></P>;
    case 'egg':
      return <P label={alt}><path d="M22 84q38 14 76 0l-6 14H28z" fill="#b08954" /><path d="M30 86q30 10 60 0" stroke="#8a5a33" strokeWidth="4" fill="none" /><ellipse cx="60" cy="56" rx="26" ry="32" fill="#fff8ea" stroke="#e0cfa8" strokeWidth="3" /><path d="M44 34l6 6 6-6 6 6 6-6" stroke="#e0cfa8" strokeWidth="3" fill="none" /></P>;
    case 'bus':
      return <P label={alt}><rect x="16" y="26" width="88" height="56" rx="10" fill="#f7b500" /><rect x="16" y="66" width="88" height="16" fill="#e09c00" /><g fill="#cfe6ff">{[24, 46, 68].map((x) => (<rect key={x} x={x} y="34" width="18" height="16" rx="3" />))}<rect x="90" y="34" width="8" height="16" rx="3" /></g><circle cx="38" cy="86" r="10" fill="#222" /><circle cx="82" cy="86" r="10" fill="#222" /><circle cx="38" cy="86" r="4.4" fill="#9aa3ad" /><circle cx="82" cy="86" r="4.4" fill="#9aa3ad" /><circle cx="24" cy="60" r="3.4" fill="#fff3b0" /><circle cx="96" cy="60" r="3.4" fill="#fff3b0" /></P>;
    case 'eiffel':
      return (
        <P label={alt}>
          <rect width="120" height="120" fill="#bfe0f5" />
          <circle cx="96" cy="20" r="10" fill="#ffd94d" />
          <path d="M60 8l14 96H86L66 62H54L34 104H46z" fill="#5a4632" />
          <rect x="48" y="58" width="24" height="5" fill="#5a4632" /><rect x="52" y="34" width="16" height="4" fill="#5a4632" />
          <path d="M40 104q20-14 40 0" stroke="#5a4632" strokeWidth="5" fill="none" />
          <rect y="104" width="120" height="16" fill="#7dbb6a" />
        </P>
      );
    default:
      return <P label={alt}><circle cx="60" cy="60" r="34" fill="#e7d7f2" /><text x="60" y="68" textAnchor="middle" fontSize="28" fill="#5a2d82">?</text></P>;
  }
}
