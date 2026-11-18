import type { Metadata, Viewport } from 'next';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/playfair-display/latin-400.css';
import '@fontsource/playfair-display/latin-500.css';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Script from 'next/script';
import {cookies} from 'next/headers';
import {accountsEnabled,site} from '@/lib/config';
import {currentContext} from '@/lib/accounts/next';
import {ACCOUNT_COOKIE} from '@/lib/accounts/web';
import {navWorlds} from '@/lib/public/nav';
export const dynamic='force-dynamic';
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#fffcf7' }, { media: '(prefers-color-scheme: dark)', color: '#1e1326' }] };
export const metadata:Metadata={metadataBase:new URL(site.url),icons:{icon:[{url:'/brand/icon-32.png',sizes:'32x32',type:'image/png'},{url:'/brand/icon-64.png',sizes:'64x64',type:'image/png'}],apple:[{url:'/brand/icon-180.png',sizes:'180x180',type:'image/png'}]},title:{default:'SparkKindly — Think sharp. Be kind.',template:'%s | SparkKindly'},description:'A little curiosity. A little connection. Play, learn and grow with SparkKindly.',...(site.published?{}:{robots:{index:false,follow:false}})};
export default async function RootLayout({children}:{children:React.ReactNode}){const worlds=await navWorlds();const accounts=accountsEnabled();
// The header shows the visitor's own state, not just the feature flag (user feedback, 17 Nov 2026): it used to
// receive only accountsEnabled(), so a signed-in member saw "Sign in" on every page, including their own account
// page. The session is read only when an account cookie is present, so anonymous traffic pays nothing for it,
// and a failed read falls back to the signed-out header rather than breaking the page.
let signedIn=false;
if(accounts&&(await cookies()).get(ACCOUNT_COOKIE)?.value){signedIn=await currentContext().then(c=>c!==null).catch(()=>false);}
return <html lang="en" suppressHydrationWarning><body><script dangerouslySetInnerHTML={{__html:`(function(){try{var t=localStorage.getItem("sk-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`}}/><a className="skip-link" href="#main">Skip to content</a><Header worlds={worlds} signIn={accounts} signedIn={signedIn}/><noscript><style>{`@media(max-width:800px){.main-nav{display:flex;position:static;box-shadow:none;flex-wrap:wrap;flex-direction:row;padding:10px 0}.header-inner{flex-wrap:wrap}.menu-toggle{display:none}.main-nav .nav-quiz{margin:0}}`}</style></noscript><main id="main">{children}</main><Footer/><Script id="microsoft-clarity" strategy="afterInteractive">{`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","zf7nz2fpcr");`}</Script>{!site.published&&<aside className="preview-notice" aria-label="Preview status">Development preview · The public website uses a separate production build.</aside>}</body></html>}
