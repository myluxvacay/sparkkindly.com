import Link from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import PrintablesHub, { type HubItem } from '@/components/printables/PrintablesHub';
import { PrintableShare } from '@/components/printables/PrintableActions';
import { site } from '@/lib/config';
import { getDb } from '@/lib/db';
import { readImage } from '@/lib/public/body';
import { listPublic } from '@/lib/public/reads';
import { currentScope } from '@/lib/accounts/scope-next';
import { metadata as seo } from '@/lib/seo';
import { PRINTABLES_TOPIC, printableCategory } from '@/lib/printables';
import { bandChipLabel } from '@/lib/age-bands';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return seo(
    'Printables',
    'Free SparkKindly printables for families and classrooms — 300 sheets: coloring pages, tracing, counting, math, mazes, dot-to-dot, word play, crosswords, reading aids and more. Print at home, learn together.',
    '/printables/',
    { image: { url: '/api/printable-card/hub/', width: 1200, height: 630, alt: 'SparkKindly Printables — free sheets to print and learn' } },
  );
}

// Printables hub: the fifteen delivered collections over one filterable shelf. Items are Kids
// activity articles tagged 'printables' in the library, read through the same scope-filtered public
// read as every other listing, so audience rules hold here exactly as elsewhere. The shelf holds
// the whole library (300 sheets), so the read pages through the public list limit.
export default async function PrintablesPage() {
  const db = getDb();
  const scope = await currentScope();
  const items = [];
  for (let offset = 0; ; offset += 50) {
    const page = await listPublic(db, scope, { topic: PRINTABLES_TOPIC, kind: 'article', limit: 50, offset });
    items.push(...page);
    if (page.length < 50) break;
  }
  const hubItems: HubItem[] = items.map((item) => {
    const image = readImage(item.image);
    const category = printableCategory(item);
    return {
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      imageSrc: image.src ?? null,
      imageAlt: image.alt,
      categoryTopic: category?.topic ?? null,
      categoryName: category?.name ?? null,
      ageBands: item.ageBands,
      ageLabel: bandChipLabel(item.ageBands),
    };
  });
  const hubUrl = `${site.url}/printables/`;
  return (
    <div className="container section">
      <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: 'Printables' }]} />
      <p className="eyebrow">PRINT, PLAY, LEARN</p>
      <h1>Printables</h1>
      <p className="intro-text">
        300 free sheets to print at home or at school — coloring, tracing, counting, math, mazes, dot-to-dot,
        word play, crosswords, reading aids, kindness pages and story games. Print a sheet, grab the crayons,
        and learn together away from the screen.
      </p>
      <PrintablesHub items={hubItems} />
      <section className="section" aria-labelledby="request-heading">
        <h2 id="request-heading">Can&apos;t find it? Request it</h2>
        <p>
          Tell us the sheet your family or classroom needs — a topic, an animal, a celebration — and we&apos;ll add it
          to the list. <Link href="/printables/request/">Request a printable</Link> ·{' '}
          <Link href="/printables/fresh-requests/">Fresh Requests shelf</Link>
        </p>
      </section>
      <PrintableShare
        url={hubUrl}
        title="SparkKindly Printables"
        text="Free printables for kids — 300 sheets of coloring, counting, mazes, word play and more, from SparkKindly:"
        mediaUrl={`${site.url}/api/printable-card/hub/`}
      />
    </div>
  );
}
