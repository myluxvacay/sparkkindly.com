import { site } from '@/lib/config';
import { shareLinks, shareText, shareUrl, type ShareInput } from '@/lib/public/share';
import ShareClient from './ShareClient';

// "Share this" under an item (owner request). Plain anchors that work without JavaScript; the island adds the device
// share and copy buttons. childContext: a child profile, or a scope without adults (a failed lookup fails closed).
export default function ShareButtons({ item, childContext }: { item: ShareInput; childContext: boolean }) {
  const links = shareLinks(site.url, item, childContext);
  return (
    <section className="share-buttons" aria-labelledby="share-this-heading">
      <h2 id="share-this-heading">Share this</h2>
      <ShareClient url={shareUrl(site.url, item)} title={item.title} text={shareText(item)} />
      {links.length > 0 && (
        <ul>
          {links.map((l) => (
            <li key={l.id}>
              <a
                href={l.href}
                rel="noopener noreferrer"
                {...(l.href.startsWith('https:') ? { target: '_blank' } : {})}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
