import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Breadcrumb from '@/components/Breadcrumb';
import ItemCard from '@/components/item/ItemCard';
import ReportLink from '@/components/item/ReportLink';
import PrintableSheet from '@/components/printables/PrintableSheet';
import { PrintButton, PrintableShare } from '@/components/printables/PrintableActions';
import { site } from '@/lib/config';
import { getDb } from '@/lib/db';
import { readArticle, readImage } from '@/lib/public/body';
import { getPublicItem, listPublic } from '@/lib/public/reads';
import { currentScope } from '@/lib/accounts/scope-next';
import { getWorld } from '@/lib/public/worlds';
import { metadata as seo } from '@/lib/seo';
import {
  isPrintable,
  printableAgeBand,
  printableCardPath,
  printableCategory,
  printablePdfPath,
} from '@/lib/printables';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

// One database read per request, shared by the metadata and the page (same pattern as the item page).
const loadItem = cache(async (slug: string) => {
  const item = await getPublicItem(getDb(), await currentScope(), 'kids', slug);
  return item && isPrintable(item) ? item : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = await loadItem(slug);
  if (!item) return {};
  return seo(item.title, item.summary, `/printables/${item.slug}/`, {
    image: { url: printableCardPath(item.slug), width: 1200, height: 630, alt: `${item.title} — a free SparkKindly printable` },
  });
}

// Only the sheet prints: everything else on the page (site chrome, panels, buttons) is hidden, and
// the sheet is lifted to the top of the paper. Colours print exactly (the delivered sheets are
// colour); on a black-and-white printer they degrade to legible greys because every band also
// carries its text. For the crispest print, the Download PDF button serves the original PDF.
const PRINT_CSS = `
@media print {
  @page { margin: 10mm; }
  body * { visibility: hidden; }
  .printable-sheet, .printable-sheet * { visibility: visible; }
  .printable-sheet { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; border: none; box-shadow: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export default async function PrintablePage({ params }: Props) {
  const { slug } = await params;
  const item = await loadItem(slug);
  if (!item) notFound();
  const db = getDb();
  const article = readArticle(item.body);
  const image = readImage(item.image);
  const category = printableCategory(item);
  const age = printableAgeBand(item);
  const w = await getWorld(db, item.world);

  // "More in this collection": the printable's own category shelf, through the same scope-filtered
  // read as every other shelf.
  const pool = category
    ? await listPublic(db, await currentScope(), { world: 'kids', kind: 'article', topic: category.topic, limit: 24, offset: 0 })
    : [];
  const related = pool.filter((i) => i.id !== item.id).slice(0, 3);

  const pageUrl = `${site.url}/printables/${item.slug}/`;
  const actions = (
    <div className="printable-actions">
      <PrintButton />
      <a className="button" href={printablePdfPath(item.slug)}>
        ⬇ Download PDF
      </a>
      <Link className="button button-quiet" href="/printables/">
        All printables
      </Link>
    </div>
  );

  return (
    <div className="container section printable-page">
      <style>{PRINT_CSS}</style>
      <Breadcrumb
        trail={[{ name: 'Home', href: '/' }, { name: 'Printables', href: '/printables/' }, { name: item.title }]}
      />
      <p className="eyebrow">PRINTABLE{category ? ` · ${category.name.toUpperCase()}` : ''}</p>
      <h1>{item.title}</h1>
      <p className="article-summary">{item.summary}</p>
      <p className="printable-chips">
        <span className="pill">Printable</span>
        {age && <span className="pill">{age.label}</span>}
        {category && <span className="pill">{category.name}</span>}
      </p>
      {actions}
      {category && <p className="sheet-instruction">{category.instruction}</p>}
      {image.src && (
        <PrintableSheet
          title={item.title}
          image={{ src: image.src, alt: image.alt, width: image.width, height: image.height }}
        />
      )}
      {actions}

      <section className="grownups-panel" aria-labelledby="grownups-heading">
        <h2 id="grownups-heading">For grown-ups</h2>
        {article.ageGuidance && (
          <p>
            <strong>Who it is for:</strong> {article.ageGuidance}
          </p>
        )}
        {article.materials && article.materials.length > 0 && (
          <p>
            <strong>You will need:</strong> {article.materials.join(' · ')}
          </p>
        )}
        {article.supervision && (
          <p>
            <strong>Staying nearby:</strong> {article.supervision}
          </p>
        )}
        {article.safetyNotes && article.safetyNotes.length > 0 && (
          <>
            <p>
              <strong>Keep it safe:</strong>
            </p>
            <ul>
              {article.safetyNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </>
        )}
        {article.sections.map((section) => (
          <div key={section.heading}>
            <h3>{section.heading}</h3>
            {section.paragraphs.map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
          </div>
        ))}
        {article.screenFreeExtension && (
          <p>
            <strong>After the sheet:</strong> {article.screenFreeExtension}
          </p>
        )}
        {article.takeaway && <p className="muted">{article.takeaway}</p>}
      </section>

      {related.length > 0 && (
        <section className="section">
          <p className="eyebrow">MORE TO PRINT</p>
          <h2>{category ? `More in ${category.name}` : 'Keep the learning going'}</h2>
          <div className="content-grid two-col">
            {related.map((i) => (
              <ItemCard item={i} world={w ?? undefined} key={i.id} />
            ))}
          </div>
        </section>
      )}

      <PrintableShare
        url={pageUrl}
        title={item.title}
        text={`Free printable for kids: ${item.title} — from SparkKindly:`}
        mediaUrl={`${site.url}${printableCardPath(item.slug)}`}
      />

      <ReportLink world={item.world} slug={item.slug} />

      <section className="section" aria-labelledby="request-heading">
        <h2 id="request-heading">Can&apos;t find the sheet you need?</h2>
        <p>
          <Link href={`/printables/request/${category ? `?category=${category.topic}` : ''}`}>Request it</Link> — tell us
          what to create, and watch the <Link href="/printables/fresh-requests/">Fresh Requests shelf</Link>. The
          most-requested sheets get made first.
        </p>
      </section>
    </div>
  );
}
