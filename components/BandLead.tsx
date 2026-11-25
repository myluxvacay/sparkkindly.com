'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BAND_LABEL, bandMatches, CHILD_BANDS, type AgeBand } from '@/lib/age-bands';
import { BAND_CHANGED_EVENT, loadAgeBand, type StoredBand } from '@/lib/age-band-client';

// Lead-with-band listing wrapper (owner rules, 24 Nov 2026): when the visitor's stored band is
// a child band, the grid's children that carry data-bands and match the band are moved first —
// a stable reorder of THIS page's rendered items only (per-page scope: server pagination is
// untouched, so a match on a later page is not pulled forward). Nothing is hidden. With the
// band unset, 'all' or 'family' this renders the grid exactly as the server sent it.
export default function BandLead({ children, className }: { children: ReactNode; className?: string }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const originalRef = useRef<Element[]>([]);
  const [band, setBand] = useState<StoredBand | null>(null);
  const [showAll, setShowAll] = useState(false);

  const isChild = band !== null && band !== 'all' && band !== 'family' && (CHILD_BANDS as readonly string[]).includes(band);

  const applyOrder = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (!originalRef.current.length) originalRef.current = Array.from(grid.children);
    const original = originalRef.current.filter((el) => el.parentElement === grid);
    let ordered = original;
    if (isChild && !showAll) {
      const active = band as AgeBand;
      const matches = (el: Element) => {
        const raw = (el as HTMLElement).dataset.bands ?? '';
        const bands = raw.split(',').filter(Boolean) as AgeBand[];
        return bandMatches(bands, active);
      };
      ordered = [...original.filter(matches), ...original.filter((el) => !matches(el))];
    }
    for (const el of ordered) grid.appendChild(el);
  }, [band, isChild, showAll]);

  useEffect(() => {
    const initial = setTimeout(() => setBand(loadAgeBand()), 0);
    const onChanged = () => {
      setShowAll(false);
      setBand(loadAgeBand());
    };
    window.addEventListener(BAND_CHANGED_EVENT, onChanged);
    return () => {
      clearTimeout(initial);
      window.removeEventListener(BAND_CHANGED_EVENT, onChanged);
    };
  }, []);

  useEffect(() => {
    applyOrder();
  }, [applyOrder]);

  return (
    <div>
      {isChild && (
        <p className="band-lead-bar">
          {showAll ? (
            <>
              Showing everything ·{' '}
              <button type="button" className="underlined" onClick={() => setShowAll(false)}>
                Show my age band first
              </button>
            </>
          ) : (
            <>
              Showing {BAND_LABEL[band as AgeBand]} first ·{' '}
              <button type="button" className="underlined" onClick={() => setShowAll(true)}>
                Show everything
              </button>
            </>
          )}
        </p>
      )}
      <div ref={gridRef} className={className}>
        {children}
      </div>
    </div>
  );
}
