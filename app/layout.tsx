import type { Metadata } from 'next';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/playfair-display/latin-400.css';
import '@fontsource/playfair-display/latin-500.css';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import {site} from '@/lib/config';
import {navWorlds} from '@/lib/public/nav';
export const dynamic='force-dynamic';
export const metadata:Metadata={metadataBase:new URL(site.url),icons:{icon:[{url:'/brand/icon-32.png',sizes:'32x32',type:'image/png'},{url:'/brand/icon-64.png',sizes:'64x64',type:'image/png'}],apple:[{url:'/brand/icon-180.png',sizes:'180x180',type:'image/png'}]},title:{default:'SparkKindly — Think sharp. Be kind.',template:'%s | SparkKindly'},description:'A little curiosity. A little connection. Play, learn and grow with SparkKindly.',robots:{index:site.published,follow:site.published}};
export default async function RootLayout({children}:{children:React.ReactNode}){const worlds=await navWorlds();return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a><Header worlds={worlds}/><noscript><style>{`@media(max-width:800px){.main-nav{display:flex;position:static;box-shadow:none;flex-wrap:wrap;flex-direction:row;padding:10px 0}.header-inner{flex-wrap:wrap}.menu-toggle{display:none}.main-nav .nav-quiz{margin:0}}`}</style></noscript><main id="main">{children}</main><Footer/>{!site.published&&<aside className="preview-notice" aria-label="Preview status">Development preview · The public website uses a separate production build.</aside>}</body></html>}
