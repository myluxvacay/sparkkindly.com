// Colours for the generated template image. Hex values are copied from the CSS variables in app/globals.css (the
// image renderer cannot read CSS); plum is the neutral brand colour and the fallback for an unknown key.
export const PLUM = '#5b2c6f';
export const INK = '#302438';
export const CREAM = '#fff7eb';
const HEX: Record<string, string> = { gold: '#f7c948', sage: '#6ea99f', coral: '#ff7a7a' };

export const worldHex = (colorKey: string): string => HEX[colorKey] ?? PLUM;

// The title as the template image may draw it. The renderer fetches a font or emoji over the network for any
// character the bundled font lacks, which would send the title to a third party, so only ASCII and Latin-1 survive:
// typographic punctuation becomes its ASCII form, everything else is dropped and the gaps are collapsed.
const ASCII_FOR: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...' };
export const plainTitle = (title: string): string =>
  title
    .replace(/[‘’“”–—…]/g, (c) => ASCII_FOR[c])
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Breaks a title into at most maxLines lines of at most maxChars characters, on spaces. A word longer than a line is
// hard-split; overflow ends the last line with an ellipsis.
export function wrapTitle(title: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (let word of title.trim().split(/\s+/).filter(Boolean)) {
    while (word.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= maxChars) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 3).trimEnd()}...`;
  return kept;
}
