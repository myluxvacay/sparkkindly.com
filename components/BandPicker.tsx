'use client';
import { useEffect, useRef, useState } from 'react';
import { BAND_OPEN_EVENT, BAND_PICKER_OPTIONS, loadAgeBand, saveAgeBand, type StoredBand } from '@/lib/age-band-client';

// Spark's first-visit age-band picker (owner rules, 24 Nov 2026): a visitor picks a BAND only —
// never an exact age or birthdate — and the choice is kept in the browser (lib/age-band-client)
// until they change it via the footer control, which reopens this dialog with 'sk-band-open'.
// Nothing is hard-hidden by the band anywhere; it only leads listings and the daily question.
// Shows only when no stored value exists, so a returning visitor is never asked twice.
export default function BandPicker() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    // Deferred so no state is set synchronously in the effect (the SparkAssistant pattern).
    const initial = setTimeout(() => {
      if (loadAgeBand() === null) setOpen(true);
    }, 0);
    const onOpen = () => setOpen(true);
    window.addEventListener(BAND_OPEN_EVENT, onOpen);
    return () => {
      clearTimeout(initial);
      window.removeEventListener(BAND_OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    lastFocusRef.current = document.activeElement;
    // Focus the dialog itself first, so keyboard and screen-reader users land on the question.
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      // Focus trap: the dialog is aria-modal, so Tab must cycle among its own focusable
      // elements rather than escaping into the page behind the backdrop.
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (lastFocusRef.current instanceof HTMLElement) lastFocusRef.current.focus();
    };
  }, [open ]);

  if (!open) return null;

  const choose = (band: StoredBand) => {
    saveAgeBand(band);
    setOpen(false);
  };

  return (
    <div className="band-picker-backdrop">
      <div
        className="band-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="band-picker-heading"
        ref={dialogRef}
        tabIndex={-1}
      >
        <img src="/brand/spark.webp" width={88} height={130} alt="" className="band-picker-spark" />
        <h2 id="band-picker-heading">Who&rsquo;s exploring today?</h2>
        <p>
          Pick an age band and SparkKindly will lead with things that fit. We never ask an exact age,
          and you can change this any time in the footer.
        </p>
        <div className="band-picker-options" role="group" aria-label="Age bands">
          {BAND_PICKER_OPTIONS.map((o) => (
            <button key={o.value} type="button" className="button band-picker-option" onClick={() => choose(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" className="underlined band-picker-skip" onClick={() => setOpen(false)}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
