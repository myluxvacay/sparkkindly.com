import { z } from 'zod';
import { supportedKinds } from '@/lib/items/format';

// A world's goals file (agents/worlds/<slug>.md): a short front matter block of `key: value` lines, then Markdown
// sections for the voice and the things the agent must never produce. Plain parsing, no YAML dependency.
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

const frontMatter = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  audience: z.enum(['kids', 'all', 'adults']),
  maxItemsPerRun: z.coerce.number().int().min(1).max(10),
  kinds: z.string().transform(list).pipe(z.array(z.enum(supportedKinds)).min(1)),
  topics: z.string().transform(list).pipe(z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1)),
});

export type Goals = z.infer<typeof frontMatter> & { never: string[]; body: string };

export function parseGoals(text: string): Goals {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('goals file needs a front matter block between --- lines');
  const raw: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z]+):\s*(.*?)\s*$/);
    if (kv) raw[kv[1]] = kv[2];
  }
  const parsed = frontMatter.safeParse(raw);
  if (!parsed.success) throw new Error(`goals front matter: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);

  const never = m[2].match(/(?:^|\n)## Never[ \t]*\n([\s\S]*?)(?=\n## |$)/)?.[1]
    .split('\n')
    .map((l) => l.match(/^\s*[-*]\s+(.+?)\s*$/)?.[1])
    .filter((x): x is string => Boolean(x));
  if (!never?.length) throw new Error('goals file needs a "## Never" section with at least one bullet');
  return { ...parsed.data, never, body: m[2].trim() };
}
