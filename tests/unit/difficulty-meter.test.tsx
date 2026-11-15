// Difficulty indicator (owner request, Nov 15 2026): bars filled up to the level, always with the level as text.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DifficultyMeter from '@/components/item/DifficultyMeter';

describe('DifficultyMeter', () => {
  it('labels the level in text and fills the bars up to it', () => {
    const easy = renderToStaticMarkup(<DifficultyMeter level="easy" />);
    expect(easy).toContain('Difficulty: Easy');
    expect(easy.match(/difficulty-bar filled/g)).toHaveLength(1);

    const medium = renderToStaticMarkup(<DifficultyMeter level="medium" />);
    expect(medium).toContain('Difficulty: Medium');
    expect(medium.match(/difficulty-bar filled/g)).toHaveLength(2);

    const hard = renderToStaticMarkup(<DifficultyMeter level="hard" />);
    expect(hard).toContain('Difficulty: Hard');
    expect(hard.match(/difficulty-bar filled/g)).toHaveLength(3);
  });

  it('renders nothing when the item has no difficulty', () => {
    expect(renderToStaticMarkup(<DifficultyMeter level={undefined} />)).toBe('');
  });
});
