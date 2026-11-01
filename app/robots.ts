import type {MetadataRoute} from 'next';
import {site} from '@/lib/config';
export const dynamic='force-static';
export default function robots():MetadataRoute.Robots {return {rules:{userAgent:'*',...(site.published?{allow:'/',disallow:'/admin/'}:{disallow:'/'})},...(site.published?{sitemap:site.url+'/sitemap.xml'}:{})};}
