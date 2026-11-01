'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef,useState } from 'react';
import type { World } from '@/lib/public/worlds';
export default function Header({worlds}:{worlds:World[]}) {
 const [open,setOpen]=useState(false); const button=useRef<HTMLButtonElement>(null); const pathname=usePathname();
 function close(restore=false) {setOpen(false);if(restore)button.current?.focus();}
 return <header className="site-header" onKeyDown={e=>{if(e.key==='Escape' && open){e.preventDefault();close(true);}}}>
 <div className="header-inner"><Link className="wordmark" href="/" onClick={()=>close()}><img className="brand-badge" src="/brand/badge-128.webp" width={64} height={64} alt=""/><span className="brand-name">Spark<span>Kindly</span></span></Link>
 <button ref={button} className="menu-toggle" aria-expanded={open} aria-controls="main-nav" onClick={()=>setOpen(!open)}>{open?'Close ✕':'Menu ☰'}</button>
 <nav id="main-nav" aria-label="Main navigation" className={open?'main-nav open':'main-nav'}>{worlds.map(w=><Link aria-current={pathname.startsWith(`/${w.slug}/`)?'page':undefined} key={w.slug} href={`/${w.slug}/`} onClick={()=>close(true)}>{w.name}</Link>)}<Link className="button nav-quiz" href="/quiz/" onClick={()=>close(true)}>Today’s quiz <span aria-hidden="true">↗</span></Link></nav></div></header>;
}
