import { describe, expect, it } from 'vitest';
import { createSignUpLimits } from '@/lib/accounts/limits';

describe('createSignUpLimits', () => {
  it('refuses the sixth sign-up from one network in an hour, then allows again after it', () => {
    let t = 0;
    const limits = createSignUpLimits(() => t);
    for (let i = 0; i < 5; i++) expect(limits.signUp('192.0.2.1')).toBe(true);
    expect(limits.signUp('192.0.2.1')).toBe(false);
    expect(limits.signUp('192.0.2.2')).toBe(true);
    t += 60 * 60_000;
    expect(limits.signUp('192.0.2.1')).toBe(true);
  });

  it('counts an IPv6 /64 as one network', () => {
    const limits = createSignUpLimits(() => 0);
    for (let i = 0; i < 5; i++) expect(limits.signUp(`2001:db8:1:2::${i + 1}`)).toBe(true);
    expect(limits.signUp('2001:db8:1:2:ffff::9')).toBe(false);
  });
});
