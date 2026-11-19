import { notFound } from 'next/navigation';
import Breadcrumb from '@/components/Breadcrumb';
import StreakPanel from '@/components/promos/StreakPanel';
import { promosEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { getLivePromo, type Promo } from '@/lib/promos/repo';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ r?: string }> };

export async function generateMetadata({ params }: Props) {
  if (!promosEnabled()) return {};
  const promo = await getLivePromo(getDb(), (await params).slug, new Date());
  return promo ? seo(promo.title, promo.shortDescription, `/promos/${promo.slug}/`) : {};
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
  const promo = await getLivePromo(getDb(), (await params).slug, new Date());
  if (!promo) notFound();
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
      {promo.body && (
        <section aria-labelledby="how-heading">
          <h2 id="how-heading">How it works</h2>
          <Paragraphs text={promo.body} />
        </section>
      )}
      {promo.type === 'streak_draw' && <StreakPanel promo={promo} r={r} />}
      {promo.rules && (
        <section aria-labelledby="rules-heading">
          <h2 id="rules-heading">The official rules</h2>
          <Paragraphs text={promo.rules} />
        </section>
      )}
    </div>
  );
}
