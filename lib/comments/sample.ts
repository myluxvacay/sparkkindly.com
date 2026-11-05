// The post-publication sample (plan 7B, spec "Trust levels are an experiment"): about this share of newly published
// level-1 comments gets sampled_at and is reviewed by the moderation agent afterwards. Pure; its own module so the 7A
// posting code can use it without importing the moderation side. Verified by tests/unit/comments-moderation.test.ts.
export const SAMPLE_RATE = 0.1;
export const pickForSample = (random: () => number = Math.random): boolean => random() < SAMPLE_RATE;
