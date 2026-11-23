import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '@/lib/db';
import { getPublicItem } from '@/lib/public/reads';
import { currentScope } from '@/lib/accounts/scope-next';
import { isPrintable } from '@/lib/printables';

export const dynamic = 'force-dynamic';

// The PDF download for a printable (owner direction, 22 Nov 2026): the delivered sheet itself,
// byte for byte — the library arrived as finished, branded one-page PDFs, stored under
// public/printable-pdfs/ by scripts/ingest-printables.ts. The printable's page stays the
// canonical home; this file is what a share brings the next family back to fetch.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const item = await getPublicItem(getDb(), await currentScope(), 'kids', slug);
  if (!item || !isPrintable(item)) return new Response('Not found', { status: 404 });
  const file = path.join(process.cwd(), 'public', 'printable-pdfs', `${item.slug}.pdf`);
  let pdf: Buffer;
  try {
    pdf = await fs.readFile(file);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="sparkkindly-${item.slug}.pdf"`,
      'cache-control': 'public, max-age=3600',
    },
  });
}
