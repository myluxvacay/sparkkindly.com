import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, sql } from './helpers/fixtures';
import { BASE, FORM, ORIGIN, form } from './helpers/admin';

// Member accounts (Project 3A, Task 4). The preview server on 4173 runs with ACCOUNTS_ENABLED=true; the server on
// 4174 does not, so it covers the flag-off 404s. Only example.test addresses. There is no mail sink in this harness:
// the emailed link is a row in account_login_tokens, so a spec mints the token the same way requestAccountLink does.

const OFF = 'http://localhost:4174';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
};
// A date of birth `years` ago plus about seven months, so the age cannot roll over mid-run.
const dobYearsAgo = (years: number) => {
  const d = new Date(Date.now() - 200 * 86_400_000);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};
const accountRows = async (email: string) => (await sql('SELECT 1 FROM accounts WHERE email = $1', [email])).rows.length;
const mintLink = async (email: string) => {
  const token = randomBytes(32).toString('hex');
  await sql("INSERT INTO account_login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')", [hash(token), email]);
  return token;
};
let n = 0;
const fresh = () => `e2e-acct-${Date.now()}-${n++}@example.test`;

test.beforeEach(async ({ page }) => {
  // Each test is its own network, so the per-network sign-up limit (30 an hour) never trips across tests.
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${(n = n + 1) % 250}` });
});

async function signUp(page: Page, email: string, dob: string, parent?: string) {
  await page.goto('/account/sign-up/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Date of birth').fill(dob);
  if (parent) await page.getByLabel(/Parent or guardian email/).fill(parent);
  await page.getByRole('button', { name: 'Create account' }).click();
}

async function signInWithLink(page: Page, email: string) {
  const token = await mintLink(email);
  await page.goto(`/account/sign-in/link/?token=${token}`);
  await expect(page.getByText(`Sign in as ${email}`)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('an unconfirmed account shows its age group and a masked parent email on the link page; a confirmed one does not', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(14), 'guardian@example.test');
  await page.goto(`/account/sign-in/link/?token=${await mintLink(email)}`);
  await expect(page.getByText('Age 13 to 15, consent pending')).toBeVisible();
  await expect(page.getByText('g•••@example.test')).toBeVisible();
  await expect(page.getByText('guardian@example.test')).toHaveCount(0);
  await expect(page.getByText('close this page')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto(`/account/sign-in/link/?token=${await mintLink(email)}`);
  await expect(page.getByText(`Sign in as ${email}`)).toBeVisible();
  await expect(page.getByText('close this page')).toHaveCount(0);
});

test('with the flag off every account page and route is a 404 (server without ACCOUNTS_ENABLED)', async ({ request }) => {
  for (const path of ['/account/', '/account/sign-up/', '/account/sign-in/', '/account/sign-in/link/?token=x', '/account/consent/?token=x', '/account/consent/withdraw/?token=x', '/account/children/', '/account/children/playing/', '/account/children/delete/?profile=x', '/me/', '/me/interests/']) {
    expect((await request.get(OFF + path)).status(), path).toBe(404);
  }
  for (const path of ['/account/sign-up/submit/', '/account/sign-in/request/', '/account/sign-in/link/confirm/', '/account/sign-out/', '/account/consent/confirm/', '/account/consent/withdraw/confirm/', '/account/consent/resend/', '/account/children/create/', '/account/children/switch/', '/account/children/switch-back/', '/account/children/pin/', '/account/children/delete/confirm/', '/me/interests/save/']) {
    const r = await request.post(OFF + path, { headers: { ...FORM, origin: OFF }, data: form({ email: 'a@example.test' }), maxRedirects: 0 });
    expect(r.status(), path).toBe(404);
  }
});

test('a 20-year-old signs up, uses the emailed link, sees their account and signs out', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(20));
  await expect(page.getByRole('status')).toContainText('Check your email to continue');
  expect(await accountRows(email)).toBe(1);

  await signInWithLink(page, email);
  await expect(page).toHaveURL(/\/account\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText('Adult account')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const cookies = await page.context().cookies(BASE);
  expect(cookies.map((c) => c.name)).toContain('__Host-sk_account');
  const c = cookies.find((x) => x.name === '__Host-sk_account')!;
  expect([c.httpOnly, c.secure, c.sameSite, c.path]).toEqual([true, true, 'Lax', '/']);
  expect(Math.round((c.expires - Date.now() / 1000) / 86_400)).toBe(30);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/account\/sign-in\/$/);
  expect((await page.context().cookies(BASE)).find((x) => x.name === '__Host-sk_account')).toBeUndefined();
  await page.goto('/account/');
  await expect(page).toHaveURL(/\/account\/sign-in\/$/);
});

test('a used link cannot start a second session, and a signed-out cookie stays dead', async ({ page, request }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(20));
  const token = await mintLink(email);
  await page.goto(`/account/sign-in/link/?token=${token}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  const session = (await page.context().cookies(BASE)).find((x) => x.name === '__Host-sk_account')!.value;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto(`/account/sign-in/link/?token=${token}`);
  await expect(page.getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  const r = await request.get('/account/', { headers: { cookie: `__Host-sk_account=${session}` }, maxRedirects: 0 });
  expect(r.status()).toBeGreaterThanOrEqual(300);
  expect(r.status()).toBeLessThan(400);
});

test('a 12-year-old gets the child-profile message and nothing is stored', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(12));
  await expect(page.getByRole('status')).toContainText('Accounts start at 13');
  await expect(page.getByRole('status')).toContainText('child profile');
  expect(await accountRows(email)).toBe(0);
  const ever = await sql("SELECT 1 FROM accounts WHERE email LIKE '%' || $1 || '%'", [email]);
  expect(ever.rows).toHaveLength(0);
});

test('a 14-year-old is asked for a parent email, and the account says consent is pending', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(14));
  await expect(page.locator('#parent-error')).toContainText('parent or guardian');
  expect(await accountRows(email)).toBe(0);
  await expect(page.getByLabel(/Parent or guardian email/)).toHaveAttribute('aria-invalid', 'true');

  await signUp(page, email, dobYearsAgo(14), 'parent@example.test');
  await expect(page.getByRole('status')).toContainText('Check your email to continue');
  expect(await accountRows(email)).toBe(1);
  await signInWithLink(page, email);
  await expect(page.getByText('Age 13 to 15, consent pending')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('save interests only');
});

test('an existing address signing up again gets the same answer as a new one, and no second account', async ({ request }) => {
  const email = fresh();
  const post = (ip: string) =>
    request.post('/account/sign-up/submit/', { headers: { ...FORM, ...ORIGIN, 'x-forwarded-for': ip }, data: form({ email, dob: dobYearsAgo(30) }), maxRedirects: 0 });
  const a = await post('203.0.113.1');
  const b = await post('203.0.113.2');
  expect([a.status(), b.status()]).toEqual([303, 303]);
  expect(a.headers().location).toBe(b.headers().location);
  expect(await accountRows(email)).toBe(1);
});

test('a link request answers a known and an unknown address identically', async ({ request }) => {
  const known = fresh();
  await sql("INSERT INTO accounts (email, date_of_birth) VALUES ($1, '1990-01-01')", [known]);
  const ask = (email: string, ip: string) =>
    request.post('/account/sign-in/request/', { headers: { ...FORM, ...ORIGIN, 'x-forwarded-for': ip }, data: form({ email }), maxRedirects: 0 });
  const a = await ask(known, '203.0.113.10');
  const b = await ask('stranger@example.test', '203.0.113.11');
  expect([a.status(), b.status()]).toEqual([303, 303]);
  expect(a.headers().location).toBe(b.headers().location);
  expect(await a.text()).toBe(await b.text());
  expect(a.headers()['set-cookie']).toBeUndefined();
  expect(await a.text()).not.toMatch(/[0-9a-f]{64}/);
  expect((await request.post('/account/sign-in/request/', { headers: FORM, data: form({ email: known }), maxRedirects: 0 })).status()).toBe(403);
});

test('the 31st sign-up from one network in an hour is refused with 429', async ({ request }) => {
  // A network unique to this run, so a local re-run within the hour does not start out limited.
  const [x, y] = randomBytes(2);
  const ip = `198.18.${x}.${y}`;
  const codes: number[] = [];
  for (let i = 0; i < 31; i++) {
    const r = await request.post('/account/sign-up/submit/', {
      headers: { ...FORM, ...ORIGIN, 'x-forwarded-for': ip },
      data: form({ email: 'not-an-email', dob: dobYearsAgo(30) }),
      maxRedirects: 0,
    });
    codes.push(r.status());
  }
  expect(codes).toEqual([...Array(30).fill(303), 429]);
});

test('sign-out and sign-up POSTs from another origin are refused', async ({ request }) => {
  for (const path of ['/account/sign-out/', '/account/sign-up/submit/']) {
    const r = await request.post(path, { headers: { ...FORM, origin: 'https://evil.example' }, data: form({ email: 'a@example.test' }), maxRedirects: 0 });
    expect(r.status(), path).toBe(403);
  }
});

test('the date of birth field asks the browser for a birthday (WCAG 1.3.5)', async ({ page }) => {
  await page.goto('/account/sign-up/');
  await expect(page.getByLabel('Date of birth')).toHaveAttribute('autocomplete', 'bday');
});

test('the link page names the account, warns when it would switch accounts, and is generic for a bad link', async ({ page }) => {
  const a = fresh();
  const b = fresh();
  await signUp(page, a, dobYearsAgo(30));
  await signUp(page, b, dobYearsAgo(30));
  await signInWithLink(page, a);
  await expect(page.getByText(a)).toBeVisible();
  await page.goto(`/account/sign-in/link/?token=${await mintLink(b)}`);
  await expect(page.getByText(`Sign in as ${b}`)).toBeVisible();
  await expect(page.getByRole('status')).toContainText(`signed in as ${a}`);
  await expect(page.getByRole('status')).toContainText('switch accounts');
  await page.goto(`/account/sign-in/link/?token=${'0'.repeat(64)}`);
  await expect(page.getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible();
  await expect(page.getByText('Sign in as')).toHaveCount(0);
});

test('the sign-up and sign-in pages pass axe and sign-in works from the keyboard', async ({ page }) => {
  await page.goto('/account/sign-up/');
  expect(await axe(page)).toEqual([]);
  await page.goto('/account/sign-in/');
  expect(await axe(page)).toEqual([]);
  await page.getByLabel('Email address').focus();
  await page.keyboard.type('stranger@example.test');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('If that address has an account');
});

// Parent consent (Project 3B, Task 3). With no mail sink, the parent's email is the consent-token row: the spec waits for
// the rows the sign-in issued (proof the email was attempted), then mints its own token the same way issueConsentTokens does.
const consentRows = async (id: string) =>
  Number((await sql('SELECT count(*) AS n FROM account_consent_tokens WHERE account_id = $1', [id])).rows[0].n);
const mintConsent = async (email: string, purpose: 'confirm' | 'withdraw') => {
  const token = randomBytes(32).toString('hex');
  await sql(
    `INSERT INTO account_consent_tokens (token_hash, account_id, parent_email, purpose, expires_at)
     SELECT $1, id, parent_email, $2, CASE WHEN $2 = 'confirm' THEN now() + interval '30 days' END FROM accounts WHERE email = $3`,
    [hash(token), purpose, email],
  );
  return token;
};
// A 14-year-old who has used their own link; returns the account id once the parent's email has been issued.
async function pendingTeen(page: Page, email: string, parent: string) {
  await signUp(page, email, dobYearsAgo(14), parent);
  await signInWithLink(page, email);
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
  const id = (await sql('SELECT id FROM accounts WHERE email = $1', [email])).rows[0].id as string;
  await expect.poll(() => consentRows(id)).toBe(2);
  return id;
}
// axe at desktop and at 320px, with no horizontal scrolling at 320px (WCAG 1.4.10).
async function axeBothWidths(page: Page) {
  expect(await axe(page)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await axe(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 720 });
}

test('a 14-year-old confirms their link, the parent confirms consent, and the account shows it recorded', async ({ page }) => {
  const email = fresh();
  const parent = `guardian-${Date.now()}@example.test`;
  const id = await pendingTeen(page, email, parent);
  await expect(page.getByRole('status')).toContainText('Waiting for your parent or guardian to confirm');
  await page.getByRole('button', { name: 'Email my parent or guardian again' }).click();
  await expect(page).toHaveURL(/\/account\/\?consent=resent#result$/);
  await expect(page.locator('#result')).toBeFocused();
  // the resend issued a fresh confirm and withdraw pair (the earlier links stay valid); wait for it before minting next
  await expect.poll(() => consentRows(id)).toBe(4);

  const token = await mintConsent(email, 'confirm');
  await page.goto(`/account/consent/?token=${token}`);
  await expect(page.getByRole('heading', { level: 1, name: /Confirm your child/ })).toBeVisible();
  for (const held of ['their email address', 'their date of birth', 'the interests they choose', 'their quiz answers and scores']) {
    await expect(page.getByRole('listitem').filter({ hasText: held })).toBeVisible();
  }
  await expect(page.getByText(`g•••@example.test`)).toBeVisible();
  await expect(page.getByText(parent)).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect((await sql('SELECT consent_state FROM accounts WHERE id = $1', [id])).rows[0].consent_state).toBe('pending');
  await axeBothWidths(page);

  await page.getByRole('button', { name: 'Confirm and keep the account' }).click();
  await expect(page).toHaveURL(/\/account\/consent\/\?done=confirmed#result$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Thank you, consent is recorded' })).toBeFocused();
  await axeBothWidths(page);

  await page.goto('/account/');
  await expect(page.getByText('Age 13 to 15', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Recorded on \d{1,2} [A-Z][a-z]+ \d{4}$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email my parent or guardian again' })).toHaveCount(0);

  await page.goto(`/account/consent/?token=${token}`);
  await expect(page.getByRole('heading', { level: 1, name: 'This link is not valid' })).toBeVisible();
  await axeBothWidths(page);
});

test('the parent withdraw link deletes the account; signing in again finds no account', async ({ page, request }) => {
  const email = fresh();
  const id = await pendingTeen(page, email, `guardian-${Date.now()}@example.test`);
  const token = await mintConsent(email, 'withdraw');
  await page.goto(`/account/consent/withdraw/?token=${token}`);
  await expect(page.getByRole('heading', { level: 1, name: /Delete your child/ })).toBeVisible();
  await expect(page.getByText('This cannot be undone', { exact: false })).toBeVisible();
  expect(await accountRows(email)).toBe(1);
  await axeBothWidths(page);

  const scanner = await request.post('/account/consent/withdraw/confirm/', {
    headers: { ...FORM, origin: 'https://evil.example' }, data: form({ token }), maxRedirects: 0,
  });
  expect(scanner.status()).toBe(403);
  expect(await accountRows(email)).toBe(1);

  await page.getByRole('button', { name: 'Delete the account' }).click();
  await expect(page).toHaveURL(/\/account\/consent\/\?done=withdrawn#result$/);
  await expect(page.getByRole('heading', { level: 1, name: 'The account has been deleted' })).toBeFocused();
  expect(await accountRows(email)).toBe(0);
  expect(await consentRows(id)).toBe(0);
  expect((await sql('SELECT 1 FROM account_login_tokens WHERE email = $1', [email])).rows).toHaveLength(0);

  await page.goto('/account/');
  await expect(page).toHaveURL(/\/account\/sign-in\/$/);
  await page.goto(`/account/sign-in/link/?token=${await mintLink(email)}`);
  await expect(page.getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible();
  await page.goto(`/account/consent/withdraw/?token=${token}`);
  await expect(page.getByRole('heading', { level: 1, name: 'This link is not valid' })).toBeVisible();
  await axeBothWidths(page);
});

// Child profiles (Project 3C, Task 3). The adult PIN is typed into the page; nothing about it may reach a URL.
const PIN = '4826';
const sessionCookie = async (page: Page) => {
  const value = (await page.context().cookies(BASE)).find((x) => x.name === '__Host-sk_account')!.value;
  return { cookie: `__Host-sk_account=${value}` };
};
async function signedInAdult(page: Page) {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(30));
  await signInWithLink(page, email);
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
  return email;
}
async function addProfile(page: Page, name: string, firstPin: boolean) {
  await page.getByLabel('First name or nickname').fill(name);
  await page.getByRole('radio', { name: '6 to 9' }).check();
  await page.getByRole('checkbox', { name: /parent or guardian/ }).check();
  if (firstPin) {
    await page.getByLabel('PIN', { exact: true }).fill(PIN);
    await page.getByLabel('PIN again', { exact: true }).fill(PIN);
  }
  await page.getByRole('button', { name: 'Add the profile' }).click();
}

test('an adult creates a child profile with a PIN, plays as the child, and only the PIN switches back', async ({ page, request }) => {
  await signedInAdult(page);
  await page.getByRole('link', { name: 'Child profiles' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Child profiles' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  for (const label of ['PIN', 'PIN again']) {
    const pin = page.getByLabel(label, { exact: true });
    for (const [k, v] of [['type', 'password'], ['inputmode', 'numeric'], ['autocomplete', 'new-password'], ['pattern', '[0-9]{4}']]) {
      await expect(pin).toHaveAttribute(k, v);
    }
  }
  await axeBothWidths(page);

  await addProfile(page, 'Mia', true);
  await expect(page).toHaveURL(/\/account\/children\/\?r=created#result$/);
  await expect(page.locator('#result')).toBeFocused();
  await expect(page.getByRole('status')).toContainText('The profile is ready');
  await expect(page.getByText('Mia', { exact: true })).toBeVisible();
  await expect(page.getByText('age 6 to 9')).toBeVisible();
  const current = page.getByLabel('Current PIN');
  await expect(current).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(current).toHaveAttribute('title', /4 digits/);
  await expect(current).toHaveAccessibleDescription(/4 digits/);
  for (const label of ['New PIN (4 digits)', 'New PIN again']) {
    await expect(page.getByLabel(label)).toHaveAttribute('autocomplete', 'new-password');
  }
  await axeBothWidths(page);

  await page.getByRole('button', { name: 'Play as Mia' }).click();
  await expect(page).toHaveURL(/\/account\/children\/playing\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Playing as Mia' })).toBeVisible();
  const adultPin = page.getByLabel('Adult PIN');
  await expect(adultPin).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(adultPin).toHaveAttribute('title', /4 digits/);
  await expect(adultPin).toHaveAccessibleDescription(/4 digits/);
  await axeBothWidths(page);

  // Settings are not reachable: adult pages land on the "Playing as" page, adult POSTs are refused server-side.
  for (const path of ['/account/', '/account/children/', '/account/children/delete/?profile=x']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/account\/children\/playing\/$/);
  }
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  const auth = await sessionCookie(page);
  for (const path of ['/account/children/create/', '/account/children/delete/confirm/', '/account/children/switch/', '/account/children/pin/', '/account/consent/resend/', '/account/sign-out/']) {
    const r = await request.post(path, {
      headers: { ...FORM, ...ORIGIN, ...auth },
      data: form({ display_name: 'Leo', age_band: '6-9', guardian: 'on', current_pin: PIN, new_pin: '1111', new_pin_confirm: '1111' }),
      maxRedirects: 0,
    });
    expect(r.status(), path).toBe(403);
  }

  await page.getByLabel('Adult PIN').fill('0000');
  await page.getByRole('button', { name: 'Switch back' }).click();
  await expect(page).toHaveURL(/\/account\/children\/playing\/\?r=wrong#result$/);
  await expect(page.locator('#result')).toBeFocused();
  await expect(page.locator('#result')).toContainText('not right');
  await expect(page.locator('#result')).not.toContainText(/\d/);
  await expect(page.getByLabel('Adult PIN')).toHaveAttribute('aria-describedby', /result/);
  await axeBothWidths(page);

  await page.getByLabel('Adult PIN').fill(PIN);
  await page.getByRole('button', { name: 'Switch back' }).click();
  await expect(page).toHaveURL(/\/account\/children\/$/);
  expect(page.url()).not.toContain(PIN);
  expect((await page.context().cookies(BASE)).map((c) => c.name)).toEqual(['__Host-sk_account']);

  await page.getByLabel('Current PIN').fill(PIN);
  await page.getByLabel('New PIN (4 digits)').fill('1357');
  await page.getByLabel('New PIN again').fill('1357');
  await page.getByRole('button', { name: 'Change PIN' }).click();
  await expect(page.locator('#result')).toBeFocused();
  await expect(page.getByRole('status')).toContainText('Your PIN is changed');
  expect(page.url()).not.toMatch(/1357|4826/);

  await page.getByRole('link', { name: "Delete Mia's profile" }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Delete Mia's profile?" })).toBeVisible();
  await axeBothWidths(page);
  await page.getByRole('button', { name: 'Delete the profile' }).click();
  await expect(page.locator('#result')).toBeFocused();
  await expect(page.getByRole('status')).toContainText('deleted');
  await expect(page.getByText('No child profiles yet.')).toBeVisible();
});

test('a 16-year-old sees no child profile option and cannot open the page', async ({ page }) => {
  const email = fresh();
  await signUp(page, email, dobYearsAgo(16));
  await signInWithLink(page, email);
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Child profiles' })).toHaveCount(0);
  await page.goto('/account/children/');
  await expect(page).toHaveURL(/\/account\/$/);
});

test('the link page warns about switching accounts in a child profile too', async ({ page }) => {
  const other = fresh();
  await signUp(page, other, dobYearsAgo(30));
  const email = await signedInAdult(page);
  await page.goto('/account/children/');
  await addProfile(page, 'Leo', true);
  await page.getByRole('button', { name: 'Play as Leo' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Playing as Leo' })).toBeVisible();
  await page.goto(`/account/sign-in/link/?token=${await mintLink(other)}`);
  await expect(page.getByRole('status')).toContainText(`signed in as ${email}`);
  await expect(page.getByRole('status')).toContainText('switch accounts');
});

test('after five wrong PINs the switch-back page says to try later, with no counts', async ({ page }) => {
  await signedInAdult(page);
  await page.goto('/account/children/');
  await addProfile(page, 'Ada', true);
  await page.getByRole('button', { name: 'Play as Ada' }).click();
  for (let i = 0; i < 6; i++) {
    await page.getByLabel('Adult PIN').fill(i === 5 ? PIN : '0000');
    await page.getByRole('button', { name: 'Switch back' }).click();
    await expect(page).toHaveURL(/\/account\/children\/playing\/\?r=(wrong|locked)#result$/);
  }
  await expect(page).toHaveURL(/\?r=locked#result$/);
  await expect(page.locator('#result')).toBeFocused();
  await expect(page.locator('#result')).toHaveText(
    'Too many tries. Please try again later, or ask an adult to sign in again with an email link.',
  );
});

// Session-derived scope on the public pages (Project 3D, Task 2): a child profile never receives an `adults` item.
test('a child profile gets a 404 for an adults item, its world page and search omit it, anonymous visitors still see it', async ({ page, request, browser }) => {
  const slug = `e2e-scope-adults-${Date.now()}`;
  const title = 'Zephyrion grown-up scope fixture';
  await addItem({ world: 'grow', slug, audience: 'adults', title });
  try {
    const itemUrl = `/grow/${slug}/`;
    const imageUrl = `/api/template-image/grow/${slug}/`;
    const listed = (p: Page) => p.getByRole('link', { name: title });

    // Anonymous: unchanged, item page, world list, search and a publicly cacheable share image.
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    expect((await anonPage.goto(itemUrl))?.status()).toBe(200);
    await anonPage.goto('/grow/');
    await expect(listed(anonPage).first()).toBeVisible();
    await anonPage.goto('/search/?q=Zephyrion');
    await expect(listed(anonPage).first()).toBeVisible();
    await anon.close();
    const anonImage = await request.get(imageUrl);
    expect(anonImage.status()).toBe(200);
    expect(anonImage.headers()['cache-control']).toBe('public, max-age=86400');
    // A cache must key the public copy on the cookie, so it is never reused across a sign-in.
    expect(anonImage.headers()['vary']?.toLowerCase().split(/,\s*/)).toContain('cookie');

    // An adult session sees it too, but the share image is never stored in a shared cache.
    await signedInAdult(page);
    const adult = await sessionCookie(page);
    const adultImage = await request.get(imageUrl, { headers: adult });
    expect(adultImage.status()).toBe(200);
    expect(adultImage.headers()['cache-control']).toBe('private, no-store');
    expect(adultImage.headers()['vary']?.toLowerCase().split(/,\s*/)).toContain('cookie');

    await page.goto('/account/children/');
    await addProfile(page, 'Tia', true);
    await page.getByRole('button', { name: 'Play as Tia' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Playing as Tia' })).toBeVisible();
    const child = await sessionCookie(page);

    expect((await page.goto(itemUrl))?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: title })).toHaveCount(0);
    await page.goto('/grow/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(listed(page)).toHaveCount(0);
    await page.goto('/search/?q=Zephyrion');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(listed(page)).toHaveCount(0);
    const childImage = await request.get(imageUrl, { headers: child });
    expect(childImage.status()).toBe(404);
    expect((await request.get(`/report/grow/${slug}/`, { headers: child })).status()).toBe(404);

    // The same URL still works for a visitor with no account cookie.
    expect((await request.get(itemUrl)).status()).toBe(200);
  } finally {
    await sql('DELETE FROM items WHERE slug = $1', [slug]);
  }
});

test("account A cannot open the delete page for account B's profile", async ({ page }) => {
  const b = fresh();
  await sql("INSERT INTO accounts (email, date_of_birth) VALUES ($1, '1985-01-01')", [b]);
  const id = (
    await sql(
      "INSERT INTO child_profiles (account_id, display_name, age_band) SELECT id, 'Bea', '6-9' FROM accounts WHERE email = $1 RETURNING id",
      [b],
    )
  ).rows[0].id as string;
  await signedInAdult(page);
  await page.goto(`/account/children/delete/?profile=${id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'This profile is not available' })).toBeVisible();
  await expect(page.getByText('Bea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete the profile' })).toHaveCount(0);
  expect((await sql('SELECT 1 FROM child_profiles WHERE id = $1', [id])).rows).toHaveLength(1);
});

// Saved answers (Project 3D, Task 3). The play panel answers on a GET, so only our own form's same-origin submit is
// recorded; a direct navigation (Sec-Fetch-Site: none), a cross-site request or a prefetch stores nothing.
const tfQuiz = (world: string, slug: string, audience: 'kids' | 'all' | 'adults') =>
  addItem({
    world,
    slug,
    kind: 'quiz',
    audience,
    title: `Saved answer fixture ${slug}`,
    body: { mechanic: 'true_false', prompt: 'A prompt that is long enough to be valid.', difficulty: 'easy' },
    answer: { value: true, explanation: 'An explanation that is long enough to be valid.' },
  });
const responses = async (itemId: string) =>
  (await sql('SELECT profile_id, correct FROM item_responses WHERE item_id = $1', [itemId])).rows;

test('a signed-in adult answer is saved once, from the real form only; links and prefetches store nothing', async ({ page, request }) => {
  const slug = `e2e-saved-answer-${Date.now()}`;
  const id = await tfQuiz('play', slug, 'all');
  try {
    await signedInAdult(page);
    const url = `/play/${slug}/`;
    const answerUrl = `${url}?r=true`;

    // A link opened directly (Sec-Fetch-Site: none) shows the verdict but stores nothing.
    await page.goto(answerUrl);
    await expect(page.getByRole('status')).toContainText('Correct');
    await expect(page.getByText('Your answer is not saved this time. Use the answer form on this page')).toBeVisible();
    await expect(page.getByText('Your answer is saved to your profile')).toHaveCount(0);
    // A cross-site request and a same-origin prefetch with the session cookie store nothing either.
    const cookie = await sessionCookie(page);
    await request.get(answerUrl, { headers: { ...cookie, 'sec-fetch-site': 'cross-site' } });
    await request.get(answerUrl, { headers: { ...cookie, 'sec-fetch-site': 'same-origin', 'sec-purpose': 'prefetch' } });
    expect(await responses(id)).toEqual([]);

    // The real form: one row for the account holder (profile NULL), and only then the note says it is saved.
    await page.goto(url);
    await expect(page.getByText('An answer you check with this form is saved to your profile')).toBeVisible();
    await page.getByRole('radio', { name: 'False' }).check();
    await page.getByRole('button', { name: /Check answer/ }).click();
    await expect(page.getByRole('status')).toContainText('Not quite');
    await expect(page.getByText('Your answer is saved to your profile; see the')).toBeVisible();
    expect(await responses(id)).toEqual([{ profile_id: null, correct: false }]);

    // A second answer is ignored: correctness stays as first answered.
    await page.goto(url);
    await page.getByRole('radio', { name: 'True' }).check();
    await page.getByRole('button', { name: /Check answer/ }).click();
    await expect(page.getByRole('status')).toContainText('Correct');
    expect(await responses(id)).toEqual([{ profile_id: null, correct: false }]);
  } finally {
    await sql('DELETE FROM items WHERE id = $1', [id]);
  }
});

test('an anonymous visitor answering a Kids quiz stores nothing, gets no cookie or storage, and sees the unsaved note', async ({ browser }) => {
  const slug = `e2e-saved-kids-${Date.now()}`;
  const id = await tfQuiz('kids', slug, 'kids');
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`/kids/${slug}/`);
    await expect(page.getByText('SparkKindly does not save your answer; see the')).toBeVisible();
    await page.getByRole('radio', { name: 'True' }).check();
    await page.getByRole('button', { name: /Check answer/ }).click();
    await expect(page.getByRole('status')).toContainText('Correct');
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
    expect(await context.cookies()).toEqual([]);
    expect(await responses(id)).toEqual([]);
  } finally {
    await context.close();
    await sql('DELETE FROM items WHERE id = $1', [id]);
  }
});

test('a child profile answer through the real form is saved for that profile; an adults quiz is not found for it', async ({ page }) => {
  const stamp = Date.now();
  const id = await tfQuiz('play', `e2e-saved-child-${stamp}`, 'all');
  const adultsId = await tfQuiz('play', `e2e-saved-child-adults-${stamp}`, 'adults');
  try {
    const email = await signedInAdult(page);
    await page.goto('/account/children/');
    await addProfile(page, 'Noa', true);
    await page.getByRole('button', { name: 'Play as Noa' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Playing as Noa' })).toBeVisible();
    const profileId = (
      await sql('SELECT p.id FROM child_profiles p JOIN accounts a ON a.id = p.account_id WHERE a.email = $1', [email])
    ).rows[0].id as string;

    await page.goto(`/play/e2e-saved-child-${stamp}/`);
    await page.getByRole('radio', { name: 'True' }).check();
    await page.getByRole('button', { name: /Check answer/ }).click();
    await expect(page.getByRole('status')).toContainText('Correct');
    await expect(page.getByText('Your answer is saved to your profile; see the')).toBeVisible();
    expect(await responses(id)).toEqual([{ profile_id: profileId, correct: true }]);

    expect((await page.goto(`/play/e2e-saved-child-adults-${stamp}/?r=true`))?.status()).toBe(404);
    expect(await responses(adultsId)).toEqual([]);
  } finally {
    await sql('DELETE FROM items WHERE id = ANY($1::uuid[])', [[id, adultsId]]);
  }
});

// Interests and the /me dashboard (Project 3D, Task 4).
async function tabTo(page: Page, target: ReturnType<Page['locator']>) {
  for (let i = 0; i < 150; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('target never received focus');
}
const watchThirdParty = (page: Page) => {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(`${BASE}/`)) seen.push(r.url());
  });
  return seen;
};

test('an adult picks interests from the keyboard; /me lists matching items and answered history, privately', async ({ page }) => {
  const stamp = Date.now();
  const inWorld = `e2e-me-world-${stamp}`;
  const inTopic = `e2e-me-topic-${stamp}`;
  const answered = `e2e-me-answered-${stamp}`;
  const ids = [
    await addItem({ world: 'grow', slug: inWorld, title: `Quillfeather world fixture ${stamp}` }),
    await addItem({ world: 'play', slug: inTopic, title: `Quillfeather topic fixture ${stamp}`, topics: ['oceans'] }),
    await addItem({ world: 'discover', slug: answered, title: `Quillfeather answered fixture ${stamp}` }),
  ];
  try {
    const thirdParty = watchThirdParty(page);
    const email = await signedInAdult(page);
    await page.getByRole('link', { name: 'Choose your interests' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your interests' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('group', { name: 'Worlds' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Topics' })).toBeVisible();
    await axeBothWidths(page);

    // Keyboard only: Tab to each box, Space to tick it, Tab to the button, Enter to save.
    await tabTo(page, page.getByRole('checkbox', { name: 'Grow' }));
    await page.keyboard.press('Space');
    await tabTo(page, page.getByRole('checkbox', { name: 'Oceans' }));
    await page.keyboard.press('Space');
    await tabTo(page, page.getByRole('button', { name: 'Save my interests' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/me\/interests\/\?r=saved#result$/);
    await expect(page.locator('#result')).toBeFocused();
    await expect(page.getByRole('status')).toContainText('Your interests are saved');
    await expect(page.getByRole('checkbox', { name: 'Grow' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Oceans' })).toBeChecked();
    await axeBothWidths(page);

    const accountId = (await sql('SELECT id FROM accounts WHERE email = $1', [email])).rows[0].id as string;
    await sql('INSERT INTO item_responses (account_id, item_id, correct, answered_at) VALUES ($1, $2, true, now())', [accountId, ids[2]]);
    await page.getByRole('link', { name: 'See items that match' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your SparkKindly' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    for (const title of [`Quillfeather world fixture ${stamp}`, `Quillfeather topic fixture ${stamp}`]) {
      await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
    }
    await expect(page.getByRole('listitem').filter({ hasText: `Quillfeather answered fixture ${stamp}` })).toContainText('correct');
    await expect(page.getByText('You have answered 1 item, 1 correct.')).toBeVisible();
    await expect(page.getByText(/streak|missed|target/i)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Your account' })).toBeVisible();
    await axeBothWidths(page);
    expect((await page.context().cookies(BASE)).map((c) => c.name)).toEqual(['__Host-sk_account']);
    expect(thirdParty).toEqual([]);
  } finally {
    await sql('DELETE FROM items WHERE id = ANY($1::uuid[])', [ids]);
  }
});

test("a child profile's /me lists no adults item, even one it has an answer for, and offers no adult pages", async ({ page }) => {
  const stamp = Date.now();
  const kidsTitle = `Brambleglow kids fixture ${stamp}`;
  const adultsTitle = `Brambleglow adults fixture ${stamp}`;
  const ids = [
    await addItem({ world: 'grow', slug: `e2e-me-kids-${stamp}`, audience: 'kids', title: kidsTitle }),
    await addItem({ world: 'grow', slug: `e2e-me-adults-${stamp}`, audience: 'adults', title: adultsTitle }),
  ];
  try {
    const thirdParty = watchThirdParty(page);
    const email = await signedInAdult(page);
    await page.goto('/account/children/');
    await addProfile(page, 'Rue', true);
    await page.getByRole('button', { name: 'Play as Rue' }).click();
    await page.getByRole('link', { name: 'Choose your interests' }).click();
    await expect(page.getByRole('link', { name: 'Your account' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Grow' }).check();
    await page.getByRole('button', { name: 'Save my interests' }).click();
    await expect(page.locator('#result')).toBeFocused();
    // An answer row for the adults item (as if stored before a rule changed): it must still never be shown or counted.
    await sql(
      `INSERT INTO item_responses (account_id, profile_id, item_id, correct, answered_at)
       SELECT p.account_id, p.id, $2, true, now() FROM child_profiles p JOIN accounts a ON a.id = p.account_id WHERE a.email = $1`,
      [email, ids[1]],
    );

    await page.goto('/me/');
    await expect(page.getByRole('heading', { level: 1, name: 'Hello, Rue' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: kidsTitle })).toBeVisible();
    await expect(page.getByText(adultsTitle)).toHaveCount(0);
    await expect(page.getByText('You have answered')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Your account' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Playing as Rue' })).toBeVisible();
    await axeBothWidths(page);
    expect(thirdParty).toEqual([]);
  } finally {
    await sql('DELETE FROM items WHERE id = ANY($1::uuid[])', [ids]);
  }
});
