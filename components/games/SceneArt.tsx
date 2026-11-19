// Parametric scene artwork for the visual games (lib/games/scene.ts). Every piece is an original
// simple illustration drawn for SparkKindly in a 120x120 box with its base at y=120, rendered at a
// scene position by SceneView. Pieces that take a colour use it for their main body, so a scene
// element's stated colour is the colour the player actually sees — the content gate derives colour
// facts and colour diffs from the same value, and the two can never drift apart.
// No external images, no hotlinks, no stock.

import { COLOR_HEX, type SceneColor } from '@/lib/games/scene';

const INK = '#22252d';
const eye = (cx: number, cy: number, r = 3.5) => <circle cx={cx} cy={cy} r={r} fill={INK} />;

/** One scene element's artwork, drawn in its local 120x120 box. `color` is the element's main colour. */
export default function SceneArt({ art, color }: { art: string; color?: SceneColor }) {
  const c = color ? COLOR_HEX[color] : undefined;
  switch (art) {
    case 'duck': {
      const body = c ?? COLOR_HEX.yellow;
      return (<><ellipse cx="56" cy="84" rx="34" ry="24" fill={body} /><circle cx="88" cy="58" r="16" fill={body} /><path d="M100 58l18 6-17 7z" fill="#f58a1f" />{eye(91, 55)}<path d="M30 78q16-14 30-5-14 12-30 5z" fill="#00000018" /></>);
    }
    case 'cat': {
      const body = c ?? COLOR_HEX.orange;
      return (<><path d="M84 84q22-6 18-30" stroke={body} strokeWidth="9" fill="none" strokeLinecap="round" /><ellipse cx="56" cy="88" rx="28" ry="20" fill={body} /><circle cx="42" cy="58" r="19" fill={body} /><path d="M28 46l-4-14 13 7zM56 46l4-14-13 7z" fill={body} />{eye(36, 56)}{eye(49, 56)}<path d="M40 64h5M45 66v3" stroke={INK} strokeWidth="2" fill="none" /></>);
    }
    case 'dog': {
      const body = c ?? COLOR_HEX.brown;
      return (<><ellipse cx="58" cy="86" rx="30" ry="21" fill={body} /><circle cx="88" cy="60" r="17" fill={body} /><ellipse cx="76" cy="52" rx="6" ry="12" fill="#00000030" transform="rotate(20 76 52)" />{eye(92, 57)}<ellipse cx="102" cy="66" rx="6" ry="4.5" fill={INK} /><path d="M30 78q-14-4-12-18" stroke={body} strokeWidth="8" fill="none" strokeLinecap="round" /></>);
    }
    case 'bird': {
      const body = c ?? COLOR_HEX.blue;
      return (<><ellipse cx="58" cy="76" rx="27" ry="21" fill={body} /><circle cx="82" cy="54" r="13" fill={body} /><path d="M93 54l14 4-13 6z" fill="#f58a1f" />{eye(85, 51)}<path d="M36 70q-16-12-12-26 14 4 20 16z" fill="#00000020" /><path d="M52 96v10M66 96v10" stroke="#f58a1f" strokeWidth="4" /></>);
    }
    case 'fish': {
      const body = c ?? COLOR_HEX.orange;
      return (<><path d="M14 66q30-26 58-6 14 10 34 6-20 26-40 22Q36 84 14 66z" fill={body} /><path d="M104 66l14-14v28z" fill={body} />{eye(34, 62, 4)}<path d="M56 52q6 14 0 26" stroke="#00000022" strokeWidth="5" fill="none" /><circle cx="88" cy="44" r="4" fill="#bfe0f5" /><circle cx="98" cy="32" r="3" fill="#bfe0f5" /></>);
    }
    case 'frog': {
      const body = c ?? COLOR_HEX.green;
      return (<><ellipse cx="60" cy="90" rx="34" ry="22" fill={body} /><circle cx="42" cy="62" r="10" fill={body} /><circle cx="78" cy="62" r="10" fill={body} />{eye(42, 60, 4.5)}{eye(78, 60, 4.5)}<path d="M44 92q16 10 32 0" stroke={INK} strokeWidth="3" fill="none" /></>);
    }
    case 'butterfly': {
      const wing = c ?? COLOR_HEX.purple;
      return (<><ellipse cx="36" cy="58" rx="20" ry="14" fill={wing} transform="rotate(-24 36 58)" /><ellipse cx="84" cy="58" rx="20" ry="14" fill={wing} transform="rotate(24 84 58)" /><ellipse cx="40" cy="84" rx="15" ry="10" fill={wing} opacity="0.75" /><ellipse cx="80" cy="84" rx="15" ry="10" fill={wing} opacity="0.75" /><rect x="56" y="44" width="8" height="48" rx="4" fill={INK} /><path d="M58 44q-8-12-16-14M62 44q8-12 16-14" stroke={INK} strokeWidth="3" fill="none" /></>);
    }
    case 'bee':
      return (<><ellipse cx="58" cy="74" rx="28" ry="21" fill={COLOR_HEX.yellow} /><path d="M46 56v36M62 54v40M76 60v26" stroke={INK} strokeWidth="7" /><ellipse cx="48" cy="44" rx="14" ry="9" fill="#dff2ff" transform="rotate(-18 48 44)" /><ellipse cx="72" cy="42" rx="12" ry="8" fill="#dff2ff" transform="rotate(16 72 42)" />{eye(74, 70)}</>);
    case 'ladybug': {
      const body = c ?? COLOR_HEX.red;
      return (<><circle cx="60" cy="80" r="30" fill={body} /><path d="M60 52v56" stroke={INK} strokeWidth="4" /><circle cx="60" cy="52" r="10" fill={INK} /><g fill={INK}><circle cx="44" cy="76" r="5" /><circle cx="76" cy="76" r="5" /><circle cx="52" cy="94" r="4" /><circle cx="68" cy="94" r="4" /></g></>);
    }
    case 'snail': {
      const shell = c ?? COLOR_HEX.purple;
      return (<><path d="M20 104q30-10 52-4 16 4 14-10-1-10-14-10H44q-20 0-24 24z" fill="#a8d08d" /><circle cx="44" cy="76" r="26" fill={shell} /><path d="M32 66a14 14 0 1 1 8 20 9 9 0 1 1-8-8" stroke="#00000030" strokeWidth="5" fill="none" /><path d="M84 78l8-14M94 80l12-10" stroke="#a8d08d" strokeWidth="5" />{eye(94, 62, 3)}{eye(108, 68, 3)}</>);
    }
    case 'turtle': {
      const shell = c ?? COLOR_HEX.green;
      return (<><path d="M22 92a38 26 0 0 1 76 0z" fill={shell} /><path d="M38 74h44M48 62v28M72 62v28" stroke="#00000026" strokeWidth="4" /><circle cx="104" cy="84" r="10" fill="#a8d08d" />{eye(107, 82, 2.6)}<path d="M30 100h14M76 100h14" stroke="#a8d08d" strokeWidth="7" strokeLinecap="round" /></>);
    }
    case 'crab': {
      const body = c ?? COLOR_HEX.red;
      return (<><ellipse cx="60" cy="86" rx="30" ry="18" fill={body} /><circle cx="34" cy="58" r="12" fill={body} /><circle cx="86" cy="58" r="12" fill={body} /><path d="M34 58l-8-8M86 58l8-8" stroke={body} strokeWidth="6" />{eye(52, 76, 3)}{eye(68, 76, 3)}<path d="M34 98l-12 8M86 98l12 8M44 102l-6 10M76 102l6 10" stroke={body} strokeWidth="5" /></>);
    }
    case 'penguin':
      return (<><ellipse cx="60" cy="72" rx="28" ry="40" fill={INK} /><ellipse cx="60" cy="80" rx="17" ry="28" fill="#fff" />{eye(51, 50, 4)}{eye(69, 50, 4)}<path d="M55 58h10l-5 8z" fill="#f58a1f" /><path d="M44 112h13M63 112h13" stroke="#f58a1f" strokeWidth="5" /></>);
    case 'owl': {
      const body = c ?? COLOR_HEX.brown;
      return (<><ellipse cx="60" cy="72" rx="30" ry="40" fill={body} /><circle cx="47" cy="58" r="11" fill="#fff" /><circle cx="73" cy="58" r="11" fill="#fff" />{eye(47, 58, 5)}{eye(73, 58, 5)}<path d="M55 68h10l-5 7z" fill="#f7b500" /><path d="M40 34l8 10M80 34l-8 10" stroke={body} strokeWidth="6" /></>);
    }
    case 'cow': {
      const body = c ?? COLOR_HEX.white;
      return (<><ellipse cx="58" cy="82" rx="32" ry="23" fill={body} stroke="#00000014" /><path d="M30 68q10-8 18 0t4 14q-14 2-22-6z" fill={INK} opacity="0.75" /><circle cx="92" cy="58" r="16" fill={body} stroke="#00000014" /><ellipse cx="92" cy="64" rx="10" ry="7" fill="#f28bb4" /><circle cx="88" cy="63" r="2" fill={INK} /><circle cx="96" cy="63" r="2" fill={INK} />{eye(88, 52, 3)}<path d="M78 46l-8-8M106 46l8-8" stroke={body} strokeWidth="6" /></>);
    }
    case 'pig': {
      const body = c ?? COLOR_HEX.pink;
      return (<><ellipse cx="58" cy="84" rx="31" ry="22" fill={body} /><circle cx="90" cy="62" r="15" fill={body} /><ellipse cx="94" cy="65" rx="7" ry="5.5" fill="#e56aa0" /><circle cx="92" cy="65" r="1.6" fill={INK} /><circle cx="97" cy="65" r="1.6" fill={INK} />{eye(86, 56, 3)}<path d="M80 50l-4-9 10 3z" fill={body} /><path d="M28 76q-12-2-10-12" stroke={body} strokeWidth="5" fill="none" /></>);
    }
    case 'sheep': {
      const wool = c ?? COLOR_HEX.white;
      return (<><g fill={wool} stroke="#00000010"><circle cx="42" cy="72" r="16" /><circle cx="62" cy="62" r="18" /><circle cx="80" cy="74" r="15" /><circle cx="58" cy="84" r="17" /></g><circle cx="98" cy="76" r="10" fill={INK} />{eye(101, 73, 2.6)}<path d="M44 104v10M74 104v10" stroke={INK} strokeWidth="5" /></>);
    }
    case 'horse': {
      const body = c ?? COLOR_HEX.brown;
      return (<><ellipse cx="54" cy="80" rx="30" ry="19" fill={body} /><path d="M76 70l16-24 10 6-12 24z" fill={body} /><ellipse cx="98" cy="44" rx="8" ry="13" fill={body} transform="rotate(28 98 44)" /><path d="M84 48q-4-16 6-24 2 12 6 16z" fill="#5d3a1a" />{eye(96, 46, 2.8)}<path d="M36 96v16M70 96v16" stroke={body} strokeWidth="7" /><path d="M26 68q-12 10-6 24" stroke="#5d3a1a" strokeWidth="7" fill="none" /></>);
    }
    case 'chicken': {
      const body = c ?? COLOR_HEX.white;
      return (<><ellipse cx="56" cy="82" rx="27" ry="23" fill={body} stroke="#00000010" /><circle cx="82" cy="56" r="13" fill={body} stroke="#00000010" /><path d="M76 44q2-8 6-2 2-8 6-2 3 6-3 9t-9-5z" fill={COLOR_HEX.red} /><path d="M93 56l13 4-12 6z" fill="#f58a1f" />{eye(84, 53, 3)}<path d="M50 104v10M64 104v10" stroke="#f58a1f" strokeWidth="4" /></>);
    }
    case 'rabbit': {
      const body = c ?? COLOR_HEX.gray;
      return (<><path d="M44 52q-4-30 6-38 8 10 4 36zM66 52q4-30 14-34 6 12-4 34z" fill={body} /><ellipse cx="58" cy="88" rx="26" ry="20" fill={body} /><circle cx="56" cy="60" r="16" fill={body} />{eye(50, 57, 3)}{eye(62, 57, 3)}<ellipse cx="56" cy="65" rx="4" ry="3" fill="#f28bb4" /></>);
    }
    case 'fox': {
      const body = c ?? COLOR_HEX.orange;
      return (<><path d="M24 84q-14-16 2-30 16 10 14 26z" fill={body} /><path d="M26 56q-8-2-12-10 10-2 16 4z" fill="#fff" /><ellipse cx="62" cy="86" rx="27" ry="20" fill={body} /><circle cx="88" cy="60" r="15" fill={body} /><path d="M76 50l-3-13 12 6zM100 50l3-13-12 6z" fill={body} />{eye(92, 58, 3)}<ellipse cx="101" cy="66" rx="5" ry="4" fill={INK} /></>);
    }
    case 'bear': {
      const body = c ?? COLOR_HEX.brown;
      return (<><circle cx="38" cy="38" r="10" fill={body} /><circle cx="82" cy="38" r="10" fill={body} /><circle cx="60" cy="58" r="24" fill={body} /><ellipse cx="60" cy="64" rx="11" ry="8" fill="#d9b48f" /><circle cx="60" cy="59" r="3.5" fill={INK} />{eye(50, 50, 3.4)}{eye(70, 50, 3.4)}<ellipse cx="60" cy="98" rx="22" ry="14" fill={body} /></>);
    }
    case 'elephant': {
      const body = c ?? COLOR_HEX.gray;
      return (<><ellipse cx="56" cy="80" rx="32" ry="24" fill={body} /><circle cx="88" cy="62" r="16" fill={body} /><ellipse cx="80" cy="64" rx="9" ry="13" fill="#00000018" /><path d="M96 66q8 20-2 32" stroke={body} strokeWidth="9" fill="none" strokeLinecap="round" />{eye(92, 56, 3)}<path d="M38 100v12M72 100v12" stroke={body} strokeWidth="9" /></>);
    }
    case 'tree': {
      const leaf = c ?? COLOR_HEX.green;
      return (<><path d="M56 66h8l4 46H52z" fill="#7a4a21" /><circle cx="60" cy="42" r="26" fill={leaf} /><circle cx="38" cy="56" r="17" fill={leaf} /><circle cx="82" cy="56" r="17" fill={leaf} /></>);
    }
    case 'pine': {
      const leaf = c ?? COLOR_HEX.green;
      return (<><rect x="55" y="92" width="10" height="20" fill="#7a4a21" /><path d="M60 6l22 34H38z" fill={leaf} /><path d="M60 30l27 40H33z" fill={leaf} /><path d="M60 56l30 42H30z" fill={leaf} /></>);
    }
    case 'flower': {
      const petal = c ?? COLOR_HEX.pink;
      return (<><path d="M60 62v50" stroke="#3f9e4d" strokeWidth="6" /><path d="M60 92q-18-4-22-20 16 2 22 14z" fill="#3f9e4d" /><g fill={petal}><circle cx="60" cy="26" r="11" /><circle cx="42" cy="40" r="11" /><circle cx="78" cy="40" r="11" /><circle cx="48" cy="56" r="11" /><circle cx="72" cy="56" r="11" /></g><circle cx="60" cy="42" r="10" fill="#f7b500" /></>);
    }
    case 'mushroom': {
      const cap = c ?? COLOR_HEX.red;
      return (<><path d="M20 62a40 32 0 0 1 80 0z" fill={cap} /><g fill="#fff"><circle cx="44" cy="44" r="6" /><circle cx="68" cy="36" r="5" /><circle cx="82" cy="50" r="4" /></g><path d="M50 62h20l4 42q-14 6-28 0z" fill="#f3e3c2" /></>);
    }
    case 'star': {
      const body = c ?? COLOR_HEX.yellow;
      return (<><path d="M60 14l12 26 28 3-21 19 6 28-25-15-25 15 6-28L20 43l28-3z" fill={body} stroke="#00000014" /></>);
    }
    case 'moon':
      return (<><path d="M78 12a44 44 0 1 0 30 76 36 36 0 0 1-30-76z" fill={COLOR_HEX.yellow} /></>);
    case 'cloud': {
      const body = c ?? COLOR_HEX.white;
      return (<><g fill={body} stroke="#00000010"><ellipse cx="60" cy="76" rx="36" ry="18" /><circle cx="42" cy="62" r="16" /><circle cx="66" cy="54" r="20" /><circle cx="84" cy="64" r="14" /></g></>);
    }
    case 'balloon': {
      const body = c ?? COLOR_HEX.red;
      return (<><ellipse cx="60" cy="44" rx="26" ry="32" fill={body} /><path d="M56 76h8l-4 8z" fill={body} /><path d="M60 84q-8 10 0 18t0 16" stroke={INK} strokeWidth="2.5" fill="none" /><ellipse cx="50" cy="32" rx="7" ry="11" fill="#ffffff50" /></>);
    }
    case 'kite': {
      const body = c ?? COLOR_HEX.purple;
      return (<><path d="M60 8l24 34-24 34L36 42z" fill={body} /><path d="M60 8v68M36 42h48" stroke="#00000020" strokeWidth="3" /><path d="M60 76q-6 12 4 16t2 14" stroke={INK} strokeWidth="2.5" fill="none" /><path d="M62 88l10-3-2 9zM64 100l10-3-2 9z" fill={COLOR_HEX.pink} /></>);
    }
    case 'ball': {
      const body = c ?? COLOR_HEX.blue;
      return (<><circle cx="60" cy="66" r="42" fill={body} /><path d="M22 50a42 42 0 0 1 76 0M24 88a42 42 0 0 0 72 0" stroke="#ffffff" strokeWidth="7" fill="none" /></>);
    }
    case 'book': {
      const cover = c ?? COLOR_HEX.red;
      return (<><path d="M28 24q32-12 32 4v72q0-16-32-4z" fill={cover} /><path d="M92 24q-32-12-32 4v72q0-16 32-4z" fill={cover} opacity="0.8" /><path d="M34 34q20-7 20 0v54q0-7-20 0zM86 34q-20-7-20 0v54q0-7 20 0z" fill="#fff8ea" /></>);
    }
    case 'apple': {
      const body = c ?? COLOR_HEX.red;
      return (<><circle cx="60" cy="72" r="34" fill={body} /><path d="M60 40q2-12 12-16" stroke="#7a4a21" strokeWidth="5" fill="none" /><path d="M62 28q16-8 22 4-12 10-22-4z" fill="#3f9e4d" /><ellipse cx="46" cy="60" rx="8" ry="12" fill="#ffffff55" /></>);
    }
    case 'banana':
      return (<><path d="M28 22q6 56 64 68-4 11-17 9Q30 80 22 32z" fill={COLOR_HEX.yellow} /><path d="M45 20q10 46 56 58-2 11-15 10Q44 72 36 28z" fill="#ffe066" /><rect x="34" y="12" width="12" height="12" rx="3" fill="#7a4a21" /></>);
    case 'orange': {
      const body = c ?? COLOR_HEX.orange;
      return (<><circle cx="60" cy="68" r="37" fill={body} /><path d="M60 33q14-12 24-4-6 12-24 4z" fill="#3f9e4d" /><ellipse cx="46" cy="56" rx="8" ry="12" fill="#ffffff44" /></>);
    }
    case 'grapes': {
      const body = c ?? COLOR_HEX.purple;
      return (<><path d="M60 26q4-10 14-12" stroke="#7a4a21" strokeWidth="5" fill="none" /><path d="M62 16q16-6 20 6-12 8-20-6z" fill="#3f9e4d" /><g fill={body}><circle cx="44" cy="42" r="11" /><circle cx="66" cy="40" r="11" /><circle cx="84" cy="44" r="11" /><circle cx="52" cy="62" r="11" /><circle cx="74" cy="62" r="11" /><circle cx="63" cy="82" r="11" /><circle cx="63" cy="100" r="10" /></g></>);
    }
    case 'carrot':
      return (<><path d="M46 44q14-4 18 8L72 102q2 10-8 8L30 62q-6-12 16-18z" fill={COLOR_HEX.orange} /><path d="M48 40q-12-16-4-28 10 8 10 24M58 38q0-18 10-26 6 12-4 26M52 40q-16-8-26-2 8 12 22 10" fill="#3f9e4d" /><path d="M44 66l14 4M52 84l12 4" stroke="#00000020" strokeWidth="4" /></>);
    case 'cupcake': {
      const top = c ?? COLOR_HEX.pink;
      return (<><path d="M34 62h52l-8 44H42z" fill="#e0a458" /><path d="M34 62h52M38 78h44M41 94h38" stroke="#00000018" strokeWidth="4" /><path d="M28 62a32 20 0 0 1 64 0z" fill={top} /><circle cx="60" cy="34" r="8" fill={COLOR_HEX.red} /><path d="M60 26q0-8 8-10" stroke="#3f9e4d" strokeWidth="4" fill="none" /></>);
    }
    case 'shell': {
      const body = c ?? COLOR_HEX.pink;
      return (<><path d="M60 108L28 62a36 30 0 0 1 64 0z" fill={body} /><path d="M60 108V44M60 108L38 52M60 108l22-56" stroke="#00000018" strokeWidth="4" /><path d="M34 66a40 34 0 0 1 52 0" stroke="#00000012" strokeWidth="5" fill="none" /></>);
    }
    case 'boat': {
      const sail = c ?? COLOR_HEX.white;
      return (<><path d="M60 12v58" stroke="#7a4a21" strokeWidth="5" /><path d="M64 16l30 40H64z" fill={sail} stroke="#00000010" /><path d="M56 24L34 56h22z" fill={COLOR_HEX.red} /><path d="M22 74h76l-10 26H34z" fill="#8a5a33" /><path d="M14 108q12-8 24 0t24 0 24 0 24 0" stroke="#3b6fd4" strokeWidth="5" fill="none" /></>);
    }
    case 'train': {
      const body = c ?? COLOR_HEX.blue;
      return (<><rect x="26" y="34" width="62" height="46" rx="8" fill={body} /><rect x="36" y="44" width="18" height="16" fill="#dff2ff" /><rect x="60" y="44" width="18" height="16" fill="#dff2ff" /><rect x="82" y="52" width="14" height="28" fill="#00000022" /><rect x="34" y="16" width="14" height="18" fill={INK} /><circle cx="40" cy="88" r="10" fill={INK} /><circle cx="72" cy="88" r="10" fill={INK} /><path d="M14 106h92" stroke={INK} strokeWidth="5" /><circle cx="90" cy="70" r="5" fill={COLOR_HEX.yellow} /></>);
    }
    case 'car': {
      const body = c ?? COLOR_HEX.red;
      return (<><path d="M18 76l8-24q3-9 13-9h42q10 0 14 9l7 24z" fill={body} /><rect x="13" y="74" width="94" height="17" rx="8" fill="#00000024" /><rect x="13" y="74" width="94" height="17" rx="8" fill={body} opacity="0.55" /><circle cx="36" cy="93" r="11" fill={INK} /><circle cx="84" cy="93" r="11" fill={INK} /><rect x="38" y="50" width="18" height="13" fill="#dff2ff" /><rect x="63" y="50" width="18" height="13" fill="#dff2ff" /></>);
    }
    case 'rocket': {
      const body = c ?? COLOR_HEX.white;
      return (<><path d="M60 6q20 22 20 52l-8 20H48l-8-20q0-30 20-52z" fill={body} stroke="#00000014" /><circle cx="60" cy="40" r="10" fill="#3b6fd4" /><path d="M40 62q-14 10-14 26l14-6M80 62q14 10 14 26l-14-6" fill={COLOR_HEX.red} /><path d="M52 84q8 14 16 0-2 16-8 22-6-6-8-22z" fill="#f58a1f" /></>);
    }
    case 'planet': {
      const body = c ?? COLOR_HEX.purple;
      return (<><circle cx="60" cy="58" r="30" fill={body} /><ellipse cx="60" cy="62" rx="52" ry="13" fill="none" stroke={COLOR_HEX.yellow} strokeWidth="7" transform="rotate(-14 60 62)" /><circle cx="48" cy="48" r="6" fill="#00000020" /><circle cx="70" cy="66" r="4" fill="#00000020" /></>);
    }
    case 'house': {
      const wall = c ?? COLOR_HEX.yellow;
      return (<><path d="M22 58L60 24l38 34z" fill="#b0502e" /><rect x="32" y="56" width="56" height="50" fill={wall} /><rect x="52" y="76" width="16" height="30" fill="#7a4a21" /><rect x="38" y="64" width="12" height="12" fill="#dff2ff" /><rect x="70" y="64" width="12" height="12" fill="#dff2ff" /></>);
    }
    case 'gift': {
      const box = c ?? COLOR_HEX.purple;
      return (<><rect x="28" y="48" width="64" height="56" rx="4" fill={box} /><rect x="22" y="34" width="76" height="16" rx="4" fill={box} /><rect x="54" y="34" width="12" height="70" fill={COLOR_HEX.yellow} /><path d="M60 34q-18 2-20-10-1-10 10-8 10 2 10 18zM60 34q18 2 20-10 1-10-10-8-10 2-10 18z" fill="none" stroke={COLOR_HEX.yellow} strokeWidth="5" /></>);
    }
    case 'hat': {
      const body = c ?? COLOR_HEX.blue;
      return (<><path d="M38 78a22 26 0 0 1 44 0z" fill={body} /><ellipse cx="60" cy="80" rx="46" ry="9" fill={body} /><rect x="38" y="66" width="44" height="9" fill="#00000022" /></>);
    }
    case 'umbrella': {
      const body = c ?? COLOR_HEX.red;
      return (<><path d="M14 62a46 40 0 0 1 92 0q-12-10-23 0-11-10-23 0-11-10-23 0-11-10-23 0z" fill={body} /><path d="M60 24v62a10 10 0 0 1-20 0" stroke="#7a4a21" strokeWidth="6" fill="none" /></>);
    }
    case 'snowman':
      return (<><circle cx="60" cy="92" r="24" fill="#fff" stroke="#00000010" /><circle cx="60" cy="52" r="17" fill="#fff" stroke="#00000010" />{eye(54, 48, 2.6)}{eye(66, 48, 2.6)}<path d="M60 54l16 4-16 4z" fill={COLOR_HEX.orange} /><rect x="42" y="24" width="36" height="8" fill={INK} /><rect x="48" y="6" width="24" height="20" fill={INK} /><path d="M44 66L24 54M76 66l20-12" stroke="#7a4a21" strokeWidth="4" /></>);
    case 'pumpkin': {
      const body = c ?? COLOR_HEX.orange;
      return (<><ellipse cx="60" cy="72" rx="38" ry="32" fill={body} /><path d="M44 44q-8 28 0 56M76 44q8 28 0 56" stroke="#00000018" strokeWidth="5" fill="none" /><path d="M56 42q0-12 12-14-2 8-4 14z" fill="#3f9e4d" /><path d="M42 66l10 8-10 2zM78 66l-10 8 10 2z" fill={INK} /><path d="M44 88q16 10 32 0-4 8-10 4-4 6-8 0-4 6-8 0-6 4-6-4z" fill={INK} /></>);
    }
    default:
      return (<><circle cx="60" cy="66" r="36" fill="#e7d7f2" /><text x="60" y="76" textAnchor="middle" fontSize="30" fill="#5a2d82">?</text></>);
  }
}
