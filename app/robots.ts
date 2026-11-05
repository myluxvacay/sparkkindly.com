import type {MetadataRoute} from 'next';
import {site} from '@/lib/config';
export const dynamic='force-static';
// /go/ is the sponsor click route (plan 6 review): crawlers would count clicks and chase sponsor links.
export default function robots():MetadataRoute.Robots {return {rules:{userAgent:'*',...(site.published?{allow:'/',disallow:['/admin/','/go/']}:{disallow:'/'})},...(site.published?{sitemap:site.url+'/sitemap.xml'}:{})};}
