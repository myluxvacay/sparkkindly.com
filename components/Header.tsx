'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef,useState } from 'react';
import type { World } from '@/lib/public/worlds';
export default function Header({worlds,signIn=false}:{worlds:World[];signIn?:boolean}) {
 const [open,setOpen]=useState(false); const button=useRef<HTMLButtonElement>(null); const pathname=usePathname();
 function close(restore=false) {setOpen(false);if(restore)button.current?.focus();}
 function toggleTheme(){const el=document.documentElement;const next=el.dataset.theme==='dark'?'light':'dark';el.dataset.theme=next;try{localStorage.setItem('sk-theme',next)}catch{}}
 // Kids (ages 6-9, with a grown-up) sits apart from the teen worlds, labelled for the families it serves;
 // its route and link name are unchanged. Search joins the nav here; it existed unlinked before.
 const kids=worlds.find(w=>w.slug==='kids'); const main=worlds.filter(w=>w.slug!=='kids');
 const worldLink=(w:World,label?:React.ReactNode)=><Link aria-current={pathname.startsWith(`/${w.slug}/`)?'page':undefined} key={w.slug} href={`/${w.slug}/`} onClick={()=>close(true)}><span className="nav-glyph" aria-hidden="true">{w.icon}</span>{label??w.name}</Link>;
 return <header className="site-header" onKeyDown={e=>{if(e.key==='Escape' && open){e.preventDefault();close(true);}}}>
 <div className="header-inner"><Link className="wordmark" href="/" onClick={()=>close()}><img className="brand-badge" src="/brand/badge-128.webp" width={64} height={64} alt=""/><span className="brand-name">Spark<span>Kindly</span></span></Link>
 <button ref={button} className="menu-toggle" aria-expanded={open} aria-controls="main-nav" onClick={()=>setOpen(!open)}>{open?'Close ✕':'Menu ☰'}</button>
 <nav id="main-nav" aria-label="Main navigation" className={open?'main-nav open':'main-nav'}>{main.map(w=>worldLink(w))}{kids&&worldLink(kids,<>{kids.name}<span className="nav-families" aria-hidden="true"> · for families</span></>)}<Link href="/search/" onClick={()=>close(true)}><span className="nav-glyph" aria-hidden="true">⌕</span>Search</Link><Link className="button nav-quiz" href="/quiz/#play-panel" onClick={()=>close(true)}>Today’s quiz <span aria-hidden="true">↗</span></Link></nav>
 {signIn&&!pathname.startsWith('/kids/')&&<Link className="header-signin" href="/account/sign-in/" onClick={()=>close()}>Sign in</Link>}
 {!pathname.startsWith('/kids/')&&<button type="button" className="theme-toggle" aria-label="Toggle dark mode" onClick={toggleTheme}><svg className="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg><svg className="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg></button>}</div></header>;
}
