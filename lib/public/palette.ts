// Colours for the generated template image. Hex values are copied from the CSS variables in app/globals.css (the
// image renderer cannot read CSS); plum is the neutral brand colour and the fallback for an unknown key.
export const PLUM = '#5b2c6f';
export const INK = '#302438';
export const CREAM = '#fff7eb';
const HEX: Record<string, string> = { gold: '#f7c948', sage: '#6ea99f', coral: '#ff7a7a' };

export const worldHex = (colorKey: string): string => HEX[colorKey] ?? PLUM;

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
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1).trimEnd()}…`;
  return kept;
}
