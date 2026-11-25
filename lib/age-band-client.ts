'use client';
// Browser side of the age bands (owner rules, 24 Nov 2026): the visitor picks a BAND only —
// never an exact age or birthdate — and that single string is kept in localStorage under
// 'sk-age-band' until they change it. This is the owner's explicit exception to the Kids
// no-browser-storage rule: ONLY this one value is stored, no identifier and no per-item data.
// 'all' is the "Just explore" skip and means unfiltered. Every read/write is defensive: where
// storage is unavailable the band simply does not persist and the site stays unfiltered.
import { useEffect, useState } from 'react';
import { BAND_LABEL, isAgeBand, type AgeBand } from './age-bands';

export const AGE_BAND_KEY = 'sk-age-band';
export const BAND_CHANGED_EVENT = 'sk-band-changed';
export const BAND_OPEN_EVENT = 'sk-band-open';

export type StoredBand = AgeBand | 'all';

export const isStoredBand = (v: unknown): v is StoredBand => v === 'all' || isAgeBand(v);

// The picker's options, in display order; 'all' is the skip at the end.
export const BAND_PICKER_OPTIONS: { value: StoredBand; label: string }[] = [
  { value: '3-5', label: BAND_LABEL['3-5'] },
  { value: '6-8', label: BAND_LABEL['6-8'] },
  { value: '9-12', label: BAND_LABEL['9-12'] },
  { value: 'family', label: BAND_LABEL.family },
  { value: 'all', label: 'Just explore' },
];

export const storedBandLabel = (band: StoredBand): string =>
  band === 'all' ? 'Everyone' : BAND_LABEL[band];

export function loadAgeBand(): StoredBand | null {
  try {
    const v = window.localStorage.getItem(AGE_BAND_KEY);
    return isStoredBand(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveAgeBand(band: StoredBand): void {
  try {
    window.localStorage.setItem(AGE_BAND_KEY, band);
  } catch {
    // Storage blocked: the choice still applies to this page via the event below.
  }
  try {
    window.dispatchEvent(new CustomEvent<StoredBand>(BAND_CHANGED_EVENT, { detail: band }));
  } catch {
    // No event bus (very old browser): islands keep their mounted state.
  }
}

export function openBandPicker(): void {
  try {
    window.dispatchEvent(new CustomEvent(BAND_OPEN_EVENT));
  } catch {
    // Nothing to open it with; the footer control simply does nothing.
  }
}

// The shared band state for client islands: null until the stored value has been read on
// mount (and null afterwards only when the visitor has never picked one).
export function useAgeBand(): { band: StoredBand | null; setBand: (band: StoredBand) => void } {
  const [band, setBandState] = useState<StoredBand | null>(null);

  useEffect(() => {
    // Deferred like SparkAssistant's show timer, so no state is set synchronously in the effect.
    const initial = setTimeout(() => setBandState(loadAgeBand()), 0);
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      setBandState(isStoredBand(detail) ? detail : loadAgeBand());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === AGE_BAND_KEY) setBandState(isStoredBand(e.newValue) ? e.newValue : null);
    };
    window.addEventListener(BAND_CHANGED_EVENT, onChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      clearTimeout(initial);
      window.removeEventListener(BAND_CHANGED_EVENT, onChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setBand = (next: StoredBand) => {
    setBandState(next);
    saveAgeBand(next);
  };

  return { band, setBand };
}
