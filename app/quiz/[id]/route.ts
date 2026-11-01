import { getDb } from '@/lib/db';
import { findQuizBySlug } from '@/lib/public/reads';
import { anonymousScope } from '@/lib/public/scope';

export const dynamic = 'force-dynamic';

// Old dated-quiz links (/quiz/<id>/) now live at the item URL. A relative Location keeps the host the visitor used.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quiz = await findQuizBySlug(getDb(), anonymousScope(), id);
  if (!quiz) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 308, headers: { Location: `/${quiz.world}/${quiz.slug}/` } });
}
