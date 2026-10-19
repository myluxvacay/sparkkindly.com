import type { Metadata } from 'next';
import { site } from './config';
export function metadata(title:string,description:string,path:string):Metadata { return {title,description,alternates:{canonical:path},openGraph:{title,description,url:path,siteName:site.name,type:'website',images:[{url:'/brand/social-banner.jpg',width:1200,height:630,alt:'SparkKindly — Think sharp. Be kind. Five worlds: Play, Discover, Together, Grow and Kids.'}]},twitter:{card:'summary_large_image',title,description,images:['/brand/social-banner.jpg']},robots:{index:site.published,follow:site.published}}; }
export function JsonLd({data}:{data:unknown}) { return <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(data).replace(/</g,'\\u003c')}}/>; }
