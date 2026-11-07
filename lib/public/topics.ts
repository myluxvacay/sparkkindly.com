// Topics on public pages (SEO audit H1, M6): the meta description of a topic page. No Next.js imports.
// Verified by tests/unit/seo-descriptions.test.ts.

// 70 to 160 characters for any curated topic name: the long form, or a short one when the name is long.
export function topicDescription(name: string, count: number): string {
  const lead = `${count} ${count === 1 ? 'item' : 'items'} on SparkKindly about ${name}`;
  const long = `${lead}: short reads, quizzes and games to spark curiosity and kindness, newest first.`;
  return long.length <= 160 ? long : `${lead}, newest first.`;
}
