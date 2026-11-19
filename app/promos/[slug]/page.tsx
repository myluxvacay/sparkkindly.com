import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumb from '@/components/Breadcrumb';
import StreakPanel from '@/components/promos/StreakPanel';
import { promosEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { getPublicPromo, PROMO_HUB_SHARE_IMAGE, type Promo } from '@/lib/promos/repo';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ r?: string }> };

// Meta comes from the record: the share fields when the owner set them, the promo's own title and short
// description otherwise, and the hub's share card when the record names no image of its own.
export async function generateMetadata({ params }: Props) {
  if (!promosEnabled()) return {};
  try {
    const found = await getPublicPromo(getDb(), (await params).slug, new Date());
    if (!found) return {};
    const { promo } = found;
    return seo(promo.shareTitle ?? promo.title, promo.shareDescription ?? promo.shortDescription, `/promos/${promo.slug}/`, {
      image: { url: promo.shareImage ?? PROMO_HUB_SHARE_IMAGE, alt: promo.title },
    });
  } catch {
    return {};
  }
}

// Plain record text is stored as paragraphs separated by blank lines; render it as paragraphs, nothing richer.
function Paragraphs({ text }: { text: string }) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p, i) => <p key={i}>{p}</p>);
}

const fmt = (day: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`),
  );

function dates(p: Promo): string | null {
  if (p.startsOn && p.endsOn) return `${fmt(p.startsOn)} to ${fmt(p.endsOn)}`;
  if (p.startsOn) return `Starts ${fmt(p.startsOn)}`;
  if (p.endsOn) return `Runs until ${fmt(p.endsOn)}`;
  return null;
}

// One promo, rendered from its record: the generic shell (title, description, prize, how-it-works, official
// rules) is the same for every type; the mechanic panel is chosen by the record's type. A future type adds a
// panel here (and its registry entry in lib/promos/types.ts) — the shell does not change.
export default async function PromoPage({ params, searchParams }: Props) {
  if (!promosEnabled()) notFound();
  // Fail safe: an unreadable record is a 404, never an error page. An ended promotion keeps its page (a
  // shared link must never land on a 404) with an ended state instead of the entry panel.
  let found: { promo: Promo; phase: 'live' | 'ended' } | null = null;
  try {
    found = await getPublicPromo(getDb(), (await params).slug, new Date());
  } catch {
    found = null;
  }
  if (!found) notFound();
  const { promo, phase } = found;
  const { r } = await searchParams;
  const when = dates(promo);
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Promotions', href: '/promos/' }, { name: promo.title }]} />
      <p className="eyebrow">PROMOTION</p>
      <h1>{promo.title}</h1>
      <p>{promo.shortDescription}</p>
      {promo.prize && (
        <p>
          <strong>Prize:</strong> {promo.prize}
        </p>
      )}
      {when && <p className="muted">{when}</p>}
      {phase === 'ended' && (
        <div className="grown-ups" role="status">
          <h2>This promotion has ended</h2>
          <p>
            Thanks to everyone who played along. The page stays here so links to it keep working — the results
            and rules are below. Watch the <Link href="/promos/">promotions page</Link> for the next one.
          </p>
        </div>
      )}
      {promo.body && (
        <section aria-labelledby="how-heading">
          <h2 id="how-heading">How it works</h2>
          <Paragraphs text={promo.body} />
        </section>
      )}
      {phase === 'live' && promo.type === 'streak_draw' && <StreakPanel promo={promo} r={r} />}
      {promo.rules && (
        <section aria-labelledby="rules-heading">
          <h2 id="rules-heading">The official rules</h2>
          <Paragraphs text={promo.rules} />
        </section>
      )}
    </div>
  );
}
