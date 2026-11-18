// Header account state (user feedback, 17 Nov 2026): the header used to receive only the accounts
// feature flag, so a signed-in member saw "Sign in" everywhere, including their own account page.
// The layout now also passes the visitor's session state; these renders pin which link each state gets.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Header from '@/components/Header';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

describe('Header account link', () => {
  it('signed out with accounts on: Sign in, linking to the sign-in page', () => {
    const html = renderToStaticMarkup(<Header worlds={[]} signIn signedIn={false} />);
    expect(html).toContain('Sign in');
    expect(html).toContain('href="/account/sign-in"');
    expect(html).not.toContain('My Account');
  });

  it('signed in: My Account, linking to the account page, and no Sign in', () => {
    const html = renderToStaticMarkup(<Header worlds={[]} signIn signedIn />);
    expect(html).toContain('My Account');
    expect(html).toContain('href="/account"');
    expect(html).not.toContain('Sign in');
  });

  it('accounts off: neither link, signed in or not', () => {
    for (const signedIn of [false, true]) {
      const html = renderToStaticMarkup(<Header worlds={[]} signIn={false} signedIn={signedIn} />);
      expect(html).not.toContain('header-signin');
    }
  });
});
