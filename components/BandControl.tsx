'use client';
import { openBandPicker, storedBandLabel, useAgeBand } from '@/lib/age-band-client';

// The footer age-band control: shows the band this browser is exploring as and reopens the
// picker (BandPicker listens for 'sk-band-open'). With no band picked yet it is the invitation
// to pick one. Nothing is hidden by the band — it only leads listings and the daily question.
export default function BandControl() {
  const { band } = useAgeBand();
  if (band === null) {
    return (
      <p className="band-control">
        <button type="button" className="underlined" onClick={openBandPicker}>
          Choose an age band
        </button>
      </p>
    );
  }
  return (
    <p className="band-control">
      Exploring as: {storedBandLabel(band)} ·{' '}
      <button type="button" className="underlined" onClick={openBandPicker}>
        Change
      </button>
    </p>
  );
}
