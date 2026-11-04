// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CONSENT_HOLDS, consentEmail } from '@/lib/accounts/consent-email';

describe('what the account holds', () => {
  it('the email lists exactly CONSENT_HOLDS, and the consent page renders the same constant', () => {
    const text = consentEmail('request', { confirmUrl: 'c', withdrawUrl: 'w', privacyUrl: 'p' }).text;
    const listed = text.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
    expect(listed).toEqual([...CONSENT_HOLDS]);
    expect(readFileSync('app/account/consent/page.tsx', 'utf8')).toMatch(/CONSENT_HOLDS\.map/);
    expect(CONSENT_HOLDS.join(' ')).toMatch(/your email address, kept only as the record/);
  });
});
