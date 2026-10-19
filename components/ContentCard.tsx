import Picture from '@/components/Picture';
import Link from 'next/link';
import type {Article} from '@/lib/schemas';
import {articlePath,readingTime} from '@/lib/content';
import {brands} from '@/lib/config';
export default function ContentCard({article:a}:{article:Article}) {return <article className="content-card"><Link className="image-link" href={articlePath(a)} tabIndex={-1} aria-hidden="true"><Picture src={a.hero.src} alt="" width={600} height={400} sizes="(max-width: 580px) 100vw, (max-width: 800px) 50vw, 33vw"/></Link><div className="card-meta"><span className={`brand-label ${brands[a.brand].color}`}>{brands[a.brand].name}</span><span>{a.contentType==='video'?'Storyboard':`${readingTime(a)} min read`}</span></div><h3><Link href={articlePath(a)}>{a.title}</Link></h3><p>{a.description}</p>{a.ageGuidance && <small>{a.ageGuidance}</small>}</article>}
