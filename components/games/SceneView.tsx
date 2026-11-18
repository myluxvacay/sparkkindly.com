// Renders one parametric scene (lib/games/scene.ts) as a single SVG: a template backdrop, the
// fixtures the template carries (a clock that really shows the scene's clockTime, a sign that really
// prints its signText), and the scene's elements placed by their anchors. The picture a player sees
// is drawn from exactly the data the content gate derived the answer from.

import type { SceneSpec } from '@/lib/games/scene';
import SceneArt from './SceneArt';

const SKY = '#bfe6fb';
const GRASS = '#8fce6e';
const WATER = '#6fbde8';

function ClockFace({ cx, cy, r, time }: { cx: number; cy: number; r: number; time: string }) {
  const [hRaw, mRaw] = time.split(':').map((n) => Number(n));
  const h = Number.isFinite(hRaw) ? hRaw : 12;
  const m = Number.isFinite(mRaw) ? mRaw : 0;
  const hourAngle = ((h % 12) + m / 60) * 30;
  const minuteAngle = m * 6;
  const hand = (angle: number, len: number, w: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return <line x1={cx} y1={cy} x2={cx + len * Math.cos(rad)} y2={cy + len * Math.sin(rad)} stroke="#22252d" strokeWidth={w} strokeLinecap="round" />;
  };
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke="#22252d" strokeWidth={5} />
      {hand(hourAngle, r * 0.52, 7)}
      {hand(minuteAngle, r * 0.78, 5)}
      <circle cx={cx} cy={cy} r={4} fill="#22252d" />
    </g>
  );
}

function SignBoard({ x, y, text }: { x: number; y: number; text: string }) {
  const w = Math.max(150, text.length * 24 + 44);
  return (
    <g>
      <rect x={x - w / 2} y={y} width={w} height={56} rx={10} fill="#fff8ea" stroke="#7a4a21" strokeWidth={5} />
      <text x={x} y={y + 39} textAnchor="middle" fontSize={30} fontWeight={700} fill="#4a2f16" fontFamily="inherit">
        {text}
      </text>
    </g>
  );
}

function Backdrop({ scene }: { scene: SceneSpec }) {
  const { template, clockTime, signText } = scene;
  switch (template) {
    case 'pond':
      return (
        <>
          <rect width="800" height="520" fill={SKY} />
          <circle cx="700" cy="70" r="38" fill="#ffd94d" />
          <ellipse cx="200" cy="330" rx="340" ry="60" fill="#a8d08d" />
          <rect y="330" width="800" height="190" fill={WATER} />
          <path d="M0 330q100-14 200 0t200 0 200 0 200 0v14q-100 14-200 0t-200 0-200 0-200 0z" fill="#9ad1f2" />
          <path d="M36 520V380M48 520V396M764 520V384" stroke="#3f9e4d" strokeWidth="7" strokeLinecap="round" />
        </>
      );
    case 'meadow':
      return (
        <>
          <rect width="800" height="520" fill={SKY} />
          <circle cx="96" cy="76" r="40" fill="#ffd94d" />
          <ellipse cx="150" cy="330" rx="330" ry="110" fill="#a8d08d" />
          <ellipse cx="660" cy="340" rx="330" ry="120" fill="#97c96f" />
          <rect y="380" width="800" height="140" fill={GRASS} />
        </>
      );
    case 'farm':
      return (
        <>
          <rect width="800" height="520" fill={SKY} />
          <circle cx="712" cy="70" r="36" fill="#ffd94d" />
          <rect y="330" width="800" height="190" fill={GRASS} />
          <rect y="420" width="800" height="100" fill="#b98a56" />
          <g>
            <rect x="52" y="196" width="150" height="120" fill="#c0452f" />
            <path d="M40 200L127 128l87 72z" fill="#8a3222" />
            <rect x="106" y="252" width="42" height="64" fill="#7a4a21" />
            <rect x="66" y="216" width="30" height="26" fill="#fff8ea" />
          </g>
          <path d="M0 356h800M0 372h800" stroke="#e8dcc4" strokeWidth="6" />
          {[40, 180, 320, 460, 600, 740].map((x) => (
            <rect key={x} x={x} y="338" width="10" height="44" fill="#e8dcc4" />
          ))}
        </>
      );
    case 'station':
      return (
        <>
          <rect width="800" height="520" fill="#dfe8f2" />
          <rect width="800" height="86" fill="#5a6b80" />
          <path d="M0 86l60-30 60 30 60-30 60 30 60-30 60 30 60-30 60 30 60-30 60 30 60-30 60 30v14H0z" fill="#43536a" />
          <rect y="392" width="800" height="128" fill="#aab4c0" />
          <rect y="392" width="800" height="12" fill="#f7d038" />
          <path d="M0 470h800M0 492h800" stroke="#6b7684" strokeWidth="6" />
          {clockTime && <ClockFace cx={672} cy={176} r={52} time={clockTime} />}
          {signText && <SignBoard x={330} y={120} text={signText} />}
        </>
      );
    case 'market':
      return (
        <>
          <rect width="800" height="520" fill="#fdeed3" />
          <g>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <path key={i} d={`M${i * 100} 60h100v44a50 22 0 0 1-100 0z`} fill={i % 2 ? '#ffffff' : '#d43a2f'} />
            ))}
          </g>
          <rect y="404" width="800" height="116" fill="#a06a35" />
          <rect y="404" width="800" height="16" fill="#7a4a21" />
          {signText && <SignBoard x={400} y={140} text={signText} />}
        </>
      );
    case 'kitchen':
      return (
        <>
          <rect width="800" height="520" fill="#f6e8d8" />
          <rect x="56" y="70" width="190" height="170" rx="8" fill={SKY} stroke="#c9a877" strokeWidth="8" />
          <path d="M151 70v170M56 155h190" stroke="#c9a877" strokeWidth="6" />
          <circle cx="196" cy="112" r="20" fill="#ffd94d" />
          <rect y="398" width="800" height="122" fill="#b98a56" />
          <rect y="398" width="800" height="14" fill="#8a5a33" />
          <path d="M420 0v54" stroke="#22252d" strokeWidth="5" />
          <path d="M392 84a28 20 0 0 1 56 0z" fill="#f7d038" />
          {clockTime && <ClockFace cx={664} cy={130} r={46} time={clockTime} />}
          {signText && <SignBoard x={420} y={180} text={signText} />}
        </>
      );
    case 'beach':
      return (
        <>
          <rect width="800" height="520" fill={SKY} />
          <circle cx="104" cy="72" r="40" fill="#ffd94d" />
          <rect y="238" width="800" height="130" fill={WATER} />
          <path d="M0 238q100-12 200 0t200 0 200 0 200 0v12q-100 12-200 0t-200 0-200 0-200 0z" fill="#cdeffb" />
          <rect y="368" width="800" height="152" fill="#f2ddab" />
          {signText && <SignBoard x={648} y={396} text={signText} />}
        </>
      );
    case 'classroom':
      return (
        <>
          <rect width="800" height="520" fill="#eef3e6" />
          <rect x="70" y="80" width="400" height="230" rx="8" fill="#2e5d43" stroke="#7a4a21" strokeWidth="10" />
          <path d="M100 130h220M100 176h300M100 222h260" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" opacity="0.75" />
          <rect y="420" width="800" height="100" fill="#cbb491" />
          {clockTime && <ClockFace cx={664} cy={140} r={50} time={clockTime} />}
          {signText && <SignBoard x={270} y={336} text={signText} />}
        </>
      );
    case 'park':
      return (
        <>
          <rect width="800" height="520" fill={SKY} />
          <circle cx="716" cy="68" r="36" fill="#ffd94d" />
          <rect y="330" width="800" height="190" fill={GRASS} />
          <path d="M300 520q40-90 20-190h90q-16 100 30 190z" fill="#e8d5a8" />
          <g fill="#7a4a21">
            <rect x="96" y="392" width="130" height="14" rx="6" />
            <rect x="104" y="406" width="10" height="34" />
            <rect x="208" y="406" width="10" height="34" />
            <rect x="96" y="366" width="130" height="12" rx="6" />
          </g>
          {clockTime && (
            <>
              <rect x="644" y="196" width="12" height="180" fill="#43536a" />
              <ClockFace cx={650} cy={168} r={48} time={clockTime} />
            </>
          )}
          {signText && <SignBoard x={160} y={120} text={signText} />}
        </>
      );
    case 'space':
      return (
        <>
          <rect width="800" height="520" fill="#141a33" />
          <g fill="#ffffff">
            {[
              [60, 60], [150, 130], [240, 44], [330, 110], [430, 60], [520, 140], [610, 40], [700, 120],
              [110, 220], [680, 220], [380, 180], [40, 320], [750, 320], [560, 250], [210, 260],
            ].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 3.4 : 2.2} opacity={0.55 + (i % 3) * 0.2} />
            ))}
          </g>
          <circle cx="690" cy="96" r="30" fill="#f2ddab" />
          <ellipse cx="400" cy="640" rx="560" ry="210" fill="#5b4a8a" />
          <ellipse cx="240" cy="486" rx="52" ry="12" fill="#00000030" />
          <ellipse cx="580" cy="470" rx="70" ry="14" fill="#00000030" />
        </>
      );
    case 'garden':
      return (
        <>
          <rect width="800" height="520" fill={SKY} />
          <circle cx="90" cy="70" r="38" fill="#ffd94d" />
          <rect y="290" width="800" height="70" fill="#4e7d3a" />
          <rect y="360" width="800" height="160" fill={GRASS} />
          <rect y="440" width="800" height="80" fill="#8a5a33" />
          <g fill="#d43a2f">
            {[30, 120, 210, 660, 740].map((x) => (
              <circle key={x} cx={x} cy={478} r={9} />
            ))}
          </g>
          <g fill="#f28bb4">
            {[75, 165, 705].map((x) => (
              <circle key={x} cx={x} cy={492} r={8} />
            ))}
          </g>
          {signText && <SignBoard x={400} y={120} text={signText} />}
        </>
      );
    case 'street':
      return (
        <>
          <rect width="800" height="520" fill={SKY} />
          <g>
            <rect x="30" y="150" width="120" height="220" fill="#c9b8a6" />
            <rect x="180" y="110" width="140" height="260" fill="#a8bfd4" />
            <rect x="560" y="130" width="130" height="240" fill="#d4a8a0" />
            <g fill="#fff8ea">
              {[0, 1, 2].map((r) =>
                [0, 1].map((c) => <rect key={`${r}-${c}`} x={52 + c * 52} y={176 + r * 58} width="30" height="36" />),
              )}
              {[0, 1, 2].map((r) =>
                [0, 1, 2].map((c) => <rect key={`b${r}-${c}`} x={200 + c * 42} y={140 + r * 62} width="26" height="38" />),
              )}
            </g>
          </g>
          <rect y="370" width="800" height="150" fill="#6b7684" />
          <path d="M0 445h110M170 445h110M340 445h110M510 445h110M680 445h120" stroke="#f7d038" strokeWidth="8" />
          {signText && <SignBoard x={430} y={170} text={signText} />}
        </>
      );
  }
}

export default function SceneView({ scene, label }: { scene: SceneSpec; label: string }) {
  const elements = [...scene.elements].sort((a, b) => a.y - b.y);
  return (
    <svg viewBox="0 0 800 520" role="img" aria-label={label} className="scene-view">
      <Backdrop scene={scene} />
      {elements.map((el) => {
        const s = el.scale ?? 1;
        return (
          <g
            key={el.id}
            transform={`translate(${el.x} ${el.y}) scale(${el.flip ? -s : s} ${s}) translate(-60 -120)`}
          >
            <SceneArt art={el.art} color={el.color} />
          </g>
        );
      })}
    </svg>
  );
}
