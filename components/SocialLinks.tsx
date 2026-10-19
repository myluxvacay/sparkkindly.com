'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {site} from '@/lib/config';
export default function SocialLinks(){const path=usePathname();if(path==='/kids'||path.startsWith('/kids/'))return <Link href="/privacy/">For grown-ups →</Link>;return <>{Object.entries(site.socials).filter(([,url])=>url).map(([name,url])=><a key={name} href={url!}>{name}</a>)}</>}
