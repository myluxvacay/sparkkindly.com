// Save world (plan 2026-11-07 Task 2): the education-only disclaimer shown on the Save world page and every Save item.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MoneyDisclaimer, { showsMoneyDisclaimer } from '@/components/item/MoneyDisclaimer';

describe('MoneyDisclaimer', () => {
  it('says plainly that it is general information, not financial advice', () => {
    const html = renderToStaticMarkup(<MoneyDisclaimer />);
    expect(html).toContain('General information, not financial advice. Check the details with the provider before you decide.');
    expect(html).not.toMatch(/<script|<img/);
  });

  it('applies to the Save world only', () => {
    expect(showsMoneyDisclaimer('save')).toBe(true);
    for (const w of ['play', 'discover', 'together', 'grow', 'kids', 'SAVE', '']) expect(showsMoneyDisclaimer(w)).toBe(false);
  });
});
