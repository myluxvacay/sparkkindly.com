import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { itemSubmissionSchema } from '@/lib/items/format';

// Agents copy the examples in docs/item-format.md, so every one of them must be a valid submission.
const doc = readFileSync('docs/item-format.md', 'utf8');
const examples = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));

describe('docs/item-format.md', () => {
  it('has an example for each kind', () => {
    expect(examples.map((e) => e.kind).sort()).toEqual(['article', 'quiz', 'video_script']);
  });

  it.each(examples.map((e) => [e.kind, e]))('the %s example is a valid submission', (_kind, example) => {
    const result = itemSubmissionSchema.safeParse(example);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});
