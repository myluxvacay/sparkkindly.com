import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ArticleBody from '@/components/item/ArticleBody';
import Breadcrumb from '@/components/Breadcrumb';
import ItemCard from '@/components/item/ItemCard';
import PlayPanel from '@/components/item/PlayPanel';
import Picture from '@/components/Picture';
import ReportLink from '@/components/item/ReportLink';
import Sources from '@/components/item/Sources';
import VideoBlock from '@/components/item/VideoBlock';
import { site } from '@/lib/config';
import { getDb } from '@/lib/db';
import { readArticle, readImage } from '@/lib/public/body';
import { formatDay } from '@/lib/public/dates';
import { articleLd, breadcrumbLd } from '@/lib/public/jsonld';
import type { SearchParams } from '@/lib/public/play-params';
import { getPublicItem, listPublic } from '@/lib/public/reads';
import { anonymousScope } from '@/lib/public/scope';
import { getWorld } from '@/lib/public/worlds';
import { JsonLd, metadata as seo } from '@/lib/seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ world: string; slug: string }>; searchParams: Promise<SearchParams> };

// One database read per request, shared by the metadata and the page.
const loadItem = cache((world: string, slug: string) => getPublicItem(getDb(), anonymousScope(), world, slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { world, slug } = await params;
  const item = await loadItem(world, slug);
  if (!item) return {};
  const path = `/${item.world}/${item.slug}/`;
  const image = { url: `/api/template-image/${item.world}/${item.slug}/`, width: 1200, height: 630, alt: item.title };
  const base = seo(item.title, item.summary, path);
  return { ...base, openGraph: { ...base.openGraph, type: 'article', images: [image] }, twitter: { ...base.twitter, images: [image.url] } };
}

const KIND_EYEBROW: Record<string, string> = { article: 'ARTICLE', quiz: 'QUIZ', game: 'GAME' };

export default async function ItemPage({ params, searchParams }: Props) {
  const { world, slug } = await params;
  const item = await loadItem(world, slug);
  if (!item) notFound();
  const db = getDb();
  const w = await getWorld(db, item.world);
  const related = (await listPublic(db, anonymousScope(), { world: item.world, limit: 4, offset: 0 })).filter((i) => i.id !== item.id).slice(0, 3);

  const isArticle = item.kind === 'article';
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
        <p className="article-summary">{item.summary}</p>
        <p className="byline">
          {article.byline ?? 'SparkKindly'}
          {isArticle && <> · {Math.max(1, Math.ceil(words / 200))} min read</>}
          <br />
          Published {formatDay(item.publishedAt)}
        </p>
        {article.ageGuidance && <p className="pill">{article.ageGuidance}</p>}
      </div>
      {isArticle && (
        <div className="container article-media">
          {image.src ? (
            <Picture src={image.src} width={image.width ?? 1200} height={image.height ?? 800} alt={image.alt} priority />
          ) : (
            <img src={`/api/template-image/${item.world}/${item.slug}/`} width={1200} height={630} alt="" />
          )}
        </div>
      )}
      {isArticle && <VideoBlock article={article} />}
      {isArticle ? <ArticleBody article={article} /> : <div className="container section quiz-page"><PlayPanel item={item} searchParams={await searchParams} /></div>}
      <Sources sources={item.sources} article={article} image={image} />
      <div className="container">
        <ReportLink world={item.world} slug={item.slug} />
      </div>
      {related.length > 0 && (
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
      {isArticle && <JsonLd data={articleLd(item, site.url)} />}
    </>
  );
}
