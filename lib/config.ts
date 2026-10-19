export const site = {
  name: 'SparkKindly', url: 'https://sparkkindly.com',
  // Explicit release switch. Production validation refuses incomplete approvals/assets.
  published: process.env.SITE_RELEASE !== 'false',
  contactEmail: null as string | null,
  socials: { youtube: null, instagram: null, facebook: null, tiktok: null } as Record<string, string | null>,
};
export const brands = {
  play: { name: 'Play', promise: 'Play. Imagine. Explore.', description: 'A little challenge. A fresh perspective. Make room for the joy of figuring things out.', short: 'Give your curiosity a little room to play.', icon: '✳', color: 'gold' },
  discover: { name: 'Discover', promise: 'Explore the world with wonder.', description: 'Follow a question somewhere unexpected. Look a little closer at the extraordinary in the everyday.', short: 'Big wonders, hiding in plain sight.', icon: '◎', color: 'sage' },
  together: { name: 'Together', promise: 'Small acts. Stronger connections.', description: 'Stories and simple ideas for showing up, paying attention, and making someone’s day a little brighter.', short: 'Small moments. A little more connection.', icon: '⌘', color: 'coral' },
  grow: { name: 'Grow', promise: 'Take one thoughtful step.', description: 'Pause, reflect, and find your next small step. There is no finish line and no need to rush.', short: 'Make space for your next small step.', icon: '↗', color: 'sage' },
  kids: { name: 'Kids', promise: 'Wonder, learn and be kind.', description: 'Simple discoveries for ages 6–9, with an adult alongside. A little screen time, a lot of real-world wonder.', short: 'Little discoveries, shared with a grown-up.', icon: '☀', color: 'gold' },
} as const;
export type Brand = keyof typeof brands;
export function isBrand(value: string): value is Brand { return value in brands && Object.hasOwn(brands, value); }
