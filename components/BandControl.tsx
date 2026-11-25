'use client';
import { openBandPicker, storedBandLabel, useAgeBand } from '@/lib/age-band-client';

// The age-band control: shows the band this browser is exploring as and reopens the picker
// (BandPicker listens for 'sk-band-open'). It renders in two places — a slim strip at the top
// of every page (variant="top", added 25 Nov 2026 after the owner found the footer alone too
// buried) and the footer (the default). Both instances share the one band state via
// useAgeBand/'sk-band-changed', so changing the band through either updates both at once.
// With no band picked yet it is the invitation to pick one. Nothing is hidden by the band —
// it only leads listings and the daily question.
export default function BandControl({ variant = 'footer' }: { variant?: 'footer' | 'top' }) {
  const { band } = useAgeBand();
  const className = variant === 'top' ? 'band-control band-control-top' : 'band-control';
  if (band === null) {
    if (variant === 'top') {
      return (
        <p className={className}>
          Who&rsquo;s exploring?{' '}
          <button type="button" className="underlined" onClick={openBandPicker}>
            Pick an age band
          </button>
        </p>
      );
    }
    return (
      <p className={className}>
        <button type="button" className="underlined" onClick={openBandPicker}>
          Choose an age band
        </button>
      </p>
    );
  }
  return (
    <p className={className}>
      Exploring as: {storedBandLabel(band)} ·{' '}
      <button type="button" className="underlined" onClick={openBandPicker}>
        Change
      </button>
    </p>
  );
}
