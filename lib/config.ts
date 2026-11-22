export const site = {
  name: 'SparkKindly', url: 'https://sparkkindly.com',
  // Explicit release switch. Production validation refuses incomplete approvals/assets.
  published: process.env.SITE_RELEASE !== 'false',
  // Shown on the Contact page only when the owner sets CONTACT_EMAIL to a mailbox they have confirmed they read.
  contactEmail: (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.CONTACT_EMAIL ?? '') ? process.env.CONTACT_EMAIL : null) as string | null,
  // Optional postal address for the Contact page, one line, set only in the server env (this repo is public).
  postalAddress: ((v) => (v && v.length <= 200 ? v : null))((process.env.CONTACT_ADDRESS ?? '').replace(/\s+/g, ' ').trim()) as string | null,
  // The brand's own public profiles (footer links, JSON-LD sameAs, and the /watch/ hub). The Facebook
  // value is the Page's profile id (61592978620272, per the connector's page list) — the Page has no
  // vanity username yet.
  socials: {
    youtube: 'https://www.youtube.com/channel/UCM4Xc3JxrDSXNXw0uoPu4UQ',
    instagram: 'https://www.instagram.com/sparkkindly/',
    facebook: 'https://www.facebook.com/profile.php?id=61592978620272',
    tiktok: 'https://www.tiktok.com/@sparkkindly',
  } as Record<string, string | null>,
};
// Member accounts are off until the owner turns them on: with this unset every /account route and page is a 404.
export const accountsEnabled = (): boolean => ['true', '1'].includes(process.env.ACCOUNTS_ENABLED ?? '');
// Circles (Project 4) need accounts AND their own switch; with either unset every /circles route and page is a 404.
export const circlesEnabled = (): boolean => accountsEnabled() && ['true', '1'].includes(process.env.CIRCLES_ENABLED ?? '');
// Comments (Project 7) need accounts AND their own switch; with either unset no comment section, route or admin page exists.
export const commentsEnabled = (): boolean => accountsEnabled() && ['true', '1'].includes(process.env.COMMENTS_ENABLED ?? '');
// Contributors (Project 8) need accounts AND their own switch; with either unset no contribute page, contributor page,
// byline, agent route or admin page exists.
export const contributorsEnabled = (): boolean => accountsEnabled() && ['true', '1'].includes(process.env.CONTRIBUTORS_ENABLED ?? '');
// Promotions (owner direction, 19 November 2026) need accounts (entry is an account act). Unlike the other
// features there is no opt-in env switch: whether anything is promoted is itself data — a promo shows only while
// its record is live in /admin — so the surface ships with accounts. PROMOS_ENABLED=false is an emergency
// kill switch only; while off, /promos/ and /admin/promos/ do not exist.
export const promosEnabled = (): boolean => accountsEnabled() && (process.env.PROMOS_ENABLED ?? '') !== 'false';
// Public leaderboard (Project 4.11, ADR 0004) needs accounts AND its own switch; with either unset the /leaderboard/
// route and the settings section do not exist.
export const leaderboardEnabled = (): boolean => accountsEnabled() && ['true', '1'].includes(process.env.LEADERBOARD_ENABLED ?? '');
// Sponsorship (Project 6) has its own switch, independent of accounts; with it unset no sponsor line, /go/ route,
// /sponsorship/ page or admin page exists.
export const sponsorshipEnabled = (): boolean => ['true', '1'].includes(process.env.SPONSORSHIP_ENABLED ?? '');
// Social distribution (Project 5A) has its own switch, independent of accounts; with it unset no social job runs, no
// promotion route or admin page exists and item pages never count social visits. Each platform also has its own
// switch in /admin/social/ (all off).
export const socialEnabled = (): boolean => ['true', '1'].includes(process.env.SOCIAL_ENABLED ?? '');
export const brands = {
  play: { name: 'Play', promise: 'Play. Imagine. Explore.', description: 'A little challenge. A fresh perspective. Make room for the joy of figuring things out.', short: 'Give your curiosity a little room to play.', icon: '✳', color: 'gold' },
  discover: { name: 'Discover', promise: 'Explore the world with wonder.', description: 'Follow a question somewhere unexpected. Look a little closer at the extraordinary in the everyday.', short: 'Big wonders, hiding in plain sight.', icon: '◎', color: 'sage' },
  together: { name: 'Together', promise: 'Small acts. Stronger connections.', description: 'Stories and simple ideas for showing up, paying attention, and making someone’s day a little brighter.', short: 'Small moments. A little more connection.', icon: '⌘', color: 'coral' },
  grow: { name: 'Grow', promise: 'Take one thoughtful step.', description: 'Pause, reflect, and find your next small step. There is no finish line and no need to rush.', short: 'Make space for your next small step.', icon: '↗', color: 'sage' },
  save: { name: 'Save', promise: 'Spend smart. Keep more.', description: 'Everyday money skills for everyone 13 and over: budgeting, saving and reading an offer before you sign up.', short: 'Money skills, one small habit at a time.', icon: '◇', color: 'sky' },
  kids: { name: 'Kids', promise: 'Wonder, learn and be kind.', description: 'Simple discoveries for ages 6–9, with an adult alongside. A little screen time, a lot of real-world wonder.', short: 'Little discoveries, shared with a grown-up.', icon: '☀', color: 'gold' },
} as const;
export type Brand = keyof typeof brands;
export function isBrand(value: string): value is Brand { return value in brands && Object.hasOwn(brands, value); }
