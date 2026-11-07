// The Save world's education-only notice (plan 2026-11-07): on the world page and on every Save item page.
export const showsMoneyDisclaimer = (world: string): boolean => world === 'save';

export default function MoneyDisclaimer() {
  return (
    <p className="money-disclaimer">
      General information, not financial advice. Check the details with the provider before you decide.
    </p>
  );
}
