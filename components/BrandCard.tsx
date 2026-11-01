import Link from 'next/link';
import { brands, isBrand } from '@/lib/config';
import type { World } from '@/lib/public/worlds';

// The five launch worlds keep their written blurb; any other world uses its stored description.
export default function BrandCard({ world, index }: { world: World; index: number }) {
  const blurb = isBrand(world.slug) ? brands[world.slug].short : (world.description ?? '');
  return (
    <Link className={`world-card world-${world.color ?? 'gold'}`} href={`/${world.slug}/`}>
      <div className="world-top">
        <span className="world-number">0{index + 1}</span>
        <span className="world-icon" aria-hidden="true">{world.icon}</span>
      </div>
      <h3>{world.name}</h3>
      <p>{blurb}</p>
      <span className="world-link">Step inside <span aria-hidden="true">↗</span></span>
    </Link>
  );
}
