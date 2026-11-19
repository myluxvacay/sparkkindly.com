import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumb from '@/components/Breadcrumb';
import { promosEnabled } from '@/lib/config';
import { getDb } from '@/lib/db';
import { listLivePromos, PROMO_HUB_SHARE_IMAGE, type Promo } from '@/lib/promos/repo';
import { metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return promosEnabled()
    ? seo(
        'Promotions',
        'SparkKindly promotions: friendly challenges with small prizes, run in the open. No purchase, ever.',
        '/promos/',
        { image: { url: PROMO_HUB_SHARE_IMAGE, alt: 'SparkKindly promotions — friendly challenges, small prizes, with Spark the mascot.' } },
      )
    : {};
}

const fmt = (day: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`),
  );

function dates(p: Promo): string {
  if (p.startsOn && p.endsOn) return `${fmt(p.startsOn)} to ${fmt(p.endsOn)}`;
  if (p.startsOn) return `Starts ${fmt(p.startsOn)}`;
  if (p.endsOn) return `Runs until ${fmt(p.endsOn)}`;
  return 'Running now';
}

// Promotions are data: this page lists whichever promo records are live today (lib/promos/repo.ts). Ending a
// promotion in /admin takes it off this page at once — no deployment is involved either way.
export default async function PromosPage() {
  if (!promosEnabled()) notFound();
  // Fail safe: if the records cannot be read, the page shows its empty state rather than an error page.
  let promos: Promo[] = [];
  try {
    promos = await listLivePromos(getDb(), new Date());
  } catch {
    promos = [];
  }
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Promotions' }]} />
      <p className="eyebrow">A LITTLE EXTRA SPARK</p>
      <h1>Promotions</h1>
      <p>Friendly challenges with small prizes, run in the open. Always free, never a purchase in sight.</p>
      {promos.length === 0 ? (
        <p className="muted">No promotion is running right now. A new one will appear here when it starts.</p>
      ) : (
        <ul className="admin-list">
          {promos.map((p) => (
            <li key={p.id}>
              <h2>
                <Link href={`/promos/${p.slug}/`}>{p.title}</Link>
              </h2>
              <p>{p.shortDescription}</p>
              {p.prize && (
                <p>
                  <strong>Prize:</strong> {p.prize}
                </p>
              )}
              <p className="muted">{dates(p)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
