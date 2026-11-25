import { cache, type ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ArticleBody from '@/components/item/ArticleBody';
import Breadcrumb from '@/components/Breadcrumb';
import ItemCard from '@/components/item/ItemCard';
import MoneyDisclaimer, { showsMoneyDisclaimer } from '@/components/item/MoneyDisclaimer';
import KeepReading from '@/components/item/KeepReading';
import PlayPanel from '@/components/item/PlayPanel';
import ReadNextEnhancer from '@/components/item/ReadNextEnhancer';
import Picture from '@/components/Picture';
import ReportLink from '@/components/item/ReportLink';
import ShareButtons from '@/components/item/ShareButtons';
import Sources from '@/components/item/Sources';
import TopicLinks from '@/components/item/TopicLinks';
import VideoBlock from '@/components/item/VideoBlock';
import { site } from '@/lib/config';
import { getDb } from '@/lib/db';
import type { PublicItem } from '@/lib/items/repo';
import { readArticle, readImage } from '@/lib/public/body';
import { stepShareCard } from '@/lib/public/step-share-card';
import { formatDay } from '@/lib/public/dates';
import { articleLd, breadcrumbLd } from '@/lib/public/jsonld';
import type { SearchParams } from '@/lib/public/play-params';
import { getPublicItem, listPublic, topicsNamed } from '@/lib/public/reads';
import { buildReadNextModel } from '@/lib/read/read-next';
import { isChildScope } from '@/lib/public/share';
import { accountSessionToken, currentScope } from '@/lib/accounts/scope-next';
import CommentSection from '@/components/comments/CommentSection';
import { loadCommentSection } from '@/lib/comments/web';
import { bylineFor } from '@/lib/contributors/byline';
import SponsorLine from '@/components/sponsorship/SponsorLine';
import SponsorCard from '@/components/sponsorship/SponsorCard';
import { loadSponsorLine } from '@/lib/sponsorship/web';
import { recordSocialVisit } from '@/lib/social/visits';
import VideoPlayer from '@/components/item/VideoPlayer';
import { getVideoId } from '@/lib/items/video';
import { getWorld } from '@/lib/public/worlds';
import { bandChipLabel } from '@/lib/age-bands';
import { JsonLd, metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ world: string; slug: string }>; searchParams: Promise<SearchParams> };

// One database read per request, shared by the metadata and the page.
const loadItem = cache(async (world: string, slug: string) => getPublicItem(getDb(), await currentScope(), world, slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { world, slug } = await params;
  const item = await loadItem(world, slug);
  if (!item) return {};
  const path = `/${item.world}/${item.slug}/`;
  // Step-strip articles share their panel-composed card (the curiosity teaser, 21 Nov 2026);
  // everything else keeps the template share image.
  const image = (item.kind === 'article' ? stepShareCard(item.body, item.title) : null) ?? {
    url: `/api/template-image/${item.world}/${item.slug}/`,
    width: 1200,
    height: 630,
    alt: item.title,
  };
  const base = seo(item.title, item.summary, path);
  // SEO audit L2: article:published_time and article:modified_time.
  const openGraph = {
    ...base.openGraph,
    type: 'article' as const,
    images: [image],
    publishedTime: item.publishedAt.toISOString(),
    modifiedTime: item.updatedAt.toISOString(),
  };
  return { ...base, openGraph, twitter: { ...base.twitter, images: [image.url] } };
}

const KIND_EYEBROW: Record<string, string> = { article: 'ARTICLE', quiz: 'QUIZ', game: 'GAME' };

export default async function ItemPage({ params, searchParams }: Props) {
  const { world, slug } = await params;
  const item = await loadItem(world, slug);
  if (!item) notFound();
  const db = getDb();
  // A landing from a social post (plan 5A): one aggregate count, nothing stored about the visitor, page unchanged.
  await recordSocialVisit(db, item.id, (await searchParams).utm_source, new Date());
  const w = await getWorld(db, item.world);
  // Null (no section in the HTML) with the flags off, for a child context, on Kids items and where switched off.
  const comments = await loadCommentSection(db, await accountSessionToken(), item.id, new Date());
  const commentCode = (await searchParams).c;
  // A contributor's credit (plan 8): only for a published contributed item, and null with the flag off.
  const credit = await bylineFor(db, item.id);
  // One sponsor line (plan 6): null with the flag off (nothing read), for a viewer who may not see it, and on an item
  // that may not carry it.
  const sponsor = await loadSponsorLine(db, await accountSessionToken(), item.id, new Date());
  const topics = await topicsNamed(db, item.topics);
  const related = (await listPublic(db, await currentScope(), { world: item.world, limit: 4, offset: 0 })).filter((i) => i.id !== item.id).slice(0, 3);

  // "Keep reading" (owner request, 20 Nov 2026): the reading counterpart of the keep-playing flow.
  // At the end of an article the reader is offered the next similar article — same series, track,
  // topics and reading band (lib/read/read-next) — instead of being dropped at the page foot. The
  // pool is the same scope-filtered read the archive uses, in this article's world; a world holding
  // nothing else falls back to the whole visible library so the panel never dead-ends. The device
  // read list follows the quiz flow's child-safety carve-out: it is never used for Kids-audience
  // articles (trackRead off), where the panel follows the server's candidates alone.
  let keepReading: ReactNode = null;
  if (item.kind === 'article') {
    const scope = await currentScope();
    const pool: PublicItem[] = [];
    for (let page = 0; page < 6; page++) {
      const rows = await listPublic(db, scope, { world: item.world, kind: 'article', limit: 50, offset: page * 50 });
      pool.push(...rows);
      if (rows.length < 50) break;
    }
    const candidates = pool.some((i) => i.id !== item.id)
      ? pool
      : await listPublic(db, scope, { kind: 'article', limit: 50, offset: 0 });
    const collection =
      item.topics.includes('poster-series') || item.topics.includes('reading')
        ? { href: '/topics/reading/', label: 'Browse the whole reading collection' }
        : topics.length > 0
          ? { href: `/topics/${topics[0].slug}/`, label: `More in ${topics[0].name}` }
          : { href: `/${item.world}/`, label: `More in ${w?.name ?? item.world}` };
    const model = buildReadNextModel(
      { id: item.id, topics: item.topics },
      candidates.map((i) => ({
        id: i.id,
        world: i.world,
        slug: i.slug,
        title: i.title,
        summary: i.summary,
        image: readImage(i.image),
        topics: i.topics,
        publishedAt: i.publishedAt.toISOString(),
      })),
      { trackRead: item.audience !== 'kids', collection },
    );
    if (model.primary) {
      keepReading = (
        <ReadNextEnhancer>
          <KeepReading model={model} />
        </ReadNextEnhancer>
      );
    }
  }

  const isArticle = item.kind === 'article';
  // An owner-attached YouTube video: never on Kids content, whatever the database holds.
  const videoId = isArticle && item.audience !== 'kids' && item.world !== 'kids' ? await getVideoId(db, item.id) : null;
  const article = readArticle(item.body);
  const image = readImage(item.image);
  const words = article.sections.flatMap((s) => s.paragraphs).join(' ').split(/\s+/).length;
  const trail = [
    { name: 'Home', path: '/' },
    { name: w?.name ?? item.world, path: `/${item.world}/` },
    { name: item.title, path: `/${item.world}/${item.slug}/` },
  ];

  return (
    <>
      <div className="container article-heading">
        <Breadcrumb trail={[{ name: 'Home', href: '/' }, { name: w?.name ?? item.world, href: `/${item.world}/` }, { name: item.title }]} />
        <p className="eyebrow">
          {(w?.name ?? item.world).toUpperCase()} · {article.fiction ? 'FICTION · ' : ''}
          {KIND_EYEBROW[item.kind] ?? 'ITEM'}
        </p>
        <h1>{item.title}</h1>
        {bandChipLabel(item.ageBands) && <p className="pill band-chip-label">{bandChipLabel(item.ageBands)}</p>}
        {sponsor && <SponsorLine line={sponsor} />}
        <p className="article-summary">{item.summary}</p>
        <p className="byline">
          {credit ? (
            <>
              By <Link href={`/contributors/${credit.slug}/`}>{credit.name}</Link>
            </>
          ) : (
            (article.byline ?? 'SparkKindly')
          )}
          {isArticle && <> · {Math.max(1, Math.ceil(words / 200))} min read</>}
          <br />
          Published {formatDay(item.publishedAt)}
        </p>
        {article.ageGuidance && <p className="pill">{article.ageGuidance}</p>}
        {showsMoneyDisclaimer(item.world) && <MoneyDisclaimer />}
      </div>
      {isArticle && (
        <div className="container article-media">
          {image.src ? (
            <Picture src={image.src} width={image.width ?? 1200} height={image.height ?? 800} alt={image.alt} priority />
          ) : (
            <img className="media-template" src={`/api/template-image/${item.world}/${item.slug}/`} width={1200} height={630} alt="" />
          )}
        </div>
      )}
      {isArticle && <VideoBlock article={article} />}
      {videoId && (
        <div className="container article-media">
          <VideoPlayer id={videoId} poster={`/api/video-poster/${item.world}/${item.slug}/`} title={item.title} />
        </div>
      )}
      {isArticle ? <ArticleBody article={article} /> : <div className="container section quiz-page quiz-item"><PlayPanel item={item} searchParams={await searchParams} /></div>}
      {keepReading && <div className="container">{keepReading}</div>}
      {sponsor && (
        <div className="container">
          <SponsorCard line={sponsor} />
        </div>
      )}
      <div className="container">
        <ShareButtons item={item} childContext={isChildScope(await currentScope())} />
      </div>
      <Sources sources={item.sources} article={article} image={image} />
      <div className="container">
        <TopicLinks topics={topics} />
        <ReportLink world={item.world} slug={item.slug} />
      </div>
      {comments && <CommentSection data={comments} code={typeof commentCode === 'string' ? commentCode : undefined} />}
      {/* Articles with a keep-reading panel end there instead: the panel is the article's discovery
          flow (next similar article + its collection), so the generic shelf below would only repeat it. */}
      {related.length > 0 && !keepReading && (
        <section className="container section">
          <p className="eyebrow">FOLLOW YOUR CURIOSITY</p>
          <h2>One more little discovery.</h2>
          <div className="content-grid two-col">
            {related.map((i) => (
              <ItemCard item={i} world={w ?? undefined} key={i.id} />
            ))}
          </div>
        </section>
      )}
      <JsonLd data={breadcrumbLd(site.url, trail)} />
      {isArticle && <JsonLd data={articleLd(item, site.url, credit ?? undefined)} />}
    </>
  );
}
