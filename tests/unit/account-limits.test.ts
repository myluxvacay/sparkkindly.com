import { describe, expect, it, vi } from 'vitest';
import {
  confirmLimits,
  createAccountLinkLimits,
  createConfirmLimits,
  createSendBudget,
  createSignUpLimits,
} from '@/lib/accounts/limits';
import { codeLimits } from '@/lib/admin/guard';

const HOUR = 60 * 60_000;

describe('createSignUpLimits', () => {
  it('allows 30 sign-ups from one network in an hour (schools, libraries, carrier NAT), refuses the 31st', () => {
    let t = 0;
    const limits = createSignUpLimits(() => t);
    for (let i = 0; i < 30; i++) expect(limits.signUp('192.0.2.1')).toBe(true);
    expect(limits.signUp('192.0.2.1')).toBe(false);
    expect(limits.signUp('192.0.2.2')).toBe(true);
    t += HOUR;
    expect(limits.signUp('192.0.2.1')).toBe(true);
  });

  it('counts an IPv6 /64 as one network', () => {
    const limits = createSignUpLimits(() => 0);
    for (let i = 0; i < 30; i++) expect(limits.signUp(`2001:db8:1:2::${i + 1}`)).toBe(true);
    expect(limits.signUp('2001:db8:1:2:ffff::9')).toBe(false);
  });
});

describe('createAccountLinkLimits', () => {
  it('allows 60 link requests per network an hour and keeps the per-address mint cap of 6', () => {
    const limits = createAccountLinkLimits(() => 0);
    for (let i = 0; i < 60; i++) expect(limits.client('192.0.2.1')).toBe(true);
    expect(limits.client('192.0.2.1')).toBe(false);
    for (let i = 0; i < 6; i++) expect(limits.mint('one@example.test')).toBe(true);
    expect(limits.mint('one@example.test')).toBe(false);
    expect(limits.mint('two@example.test')).toBe(true);
  });
});

describe('confirm limits', () => {
  it('allow 60 confirmations per network an hour', () => {
    const limits = createConfirmLimits(() => 0);
    for (let i = 0; i < 60; i++) expect(limits('192.0.2.1')).toBe(true);
    expect(limits('192.0.2.200')).toBe(false); // same /24
  });

  it('are one instance per process on their own globalThis key, separate from admin codes', () => {
    expect((globalThis as Record<string, unknown>).__sparkAccountConfirmLimits).toBe(confirmLimits);
    expect(confirmLimits).not.toBe(codeLimits);
  });
});

describe('createSendBudget', () => {
  it('allows the hourly budget, then skips with one warning line per hour (count, no address), and resets next hour', () => {
    let t = 0;
    const warn = vi.fn();
    const budget = createSendBudget({ perHour: 3, clock: () => t, warn });
    expect([budget(), budget(), budget()]).toEqual([true, true, true]);
    expect([budget(), budget()]).toEqual([false, false]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/3/);
    expect(warn.mock.calls[0][0]).not.toMatch(/@|\d+\.\d+\.\d+/);
    t += HOUR;
    expect(budget()).toBe(true);
    expect([budget(), budget(), budget()]).toEqual([true, true, false]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('defaults to 300 an hour', () => {
    const budget = createSendBudget({ clock: () => 0, warn: () => {} });
    for (let i = 0; i < 300; i++) expect(budget()).toBe(true);
    expect(budget()).toBe(false);
  });
});

describe('consent limits', () => {
  it('are their own instance and ceiling, separate from sign-in link confirmations', async () => {
    const { createConsentLimits, consentLimits } = await import('@/lib/accounts/limits');
    expect((globalThis as Record<string, unknown>).__sparkConsentLimits).toBe(consentLimits);
    expect(consentLimits).not.toBe(confirmLimits);
    const consent = createConsentLimits(() => 0);
    const confirm = createConfirmLimits(() => 0);
    for (let i = 0; i < 60; i++) expect(consent('192.0.2.1')).toBe(true);
    expect(consent('192.0.2.1')).toBe(false);
    expect(confirm('192.0.2.1')).toBe(true);
  });
});
