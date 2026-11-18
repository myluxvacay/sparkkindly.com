'use client';
import { useEffect, useRef, useState } from 'react';

// Live counter and cap for the interests form (user feedback, 17 Nov 2026): people could tick more
// than the maximum and only learned after saving, when the server refused the whole save. The count
// now updates as boxes are ticked, and at the cap the unticked boxes close — a 31st choice simply
// cannot be made. Ticked boxes are never disabled, so one can always be unticked to free a place,
// and a disabled unticked box submits nothing, exactly as an unticked one would. The plain form is
// unchanged underneath: with no JavaScript the server-side limit in lib/accounts/interests.ts is
// still the backstop and its message still explains.
export default function InterestsEnhancer({
  max,
  initial,
  children,
}: {
  max: number;
  initial: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(initial);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const sync = () => {
      const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      const n = boxes.filter((b) => b.checked).length;
      setCount(n);
      boxes.forEach((b) => {
        b.disabled = !b.checked && n >= max;
      });
    };
    // The cap is enforced twice: unticked boxes disable at the cap, and a change that would still
    // take the count past it (a scripted or restored check) is reverted on the spot.
    const onChange = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type === 'checkbox' && t.checked) {
        const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
        if (boxes.filter((b) => b.checked).length > max) t.checked = false;
      }
      sync();
    };
    sync();
    root.addEventListener('change', onChange);
    return () => root.removeEventListener('change', onChange);
  }, [max]);

  const atCap = count >= max;
  return (
    <div ref={ref}>
      <p className="interests-count" id="interests-count" aria-live="polite">
        <strong>
          {count}/{max}
        </strong>{' '}
        chosen
        {atCap && <> — that is the most you can choose. Untick one to choose another.</>}
      </p>
      {children}
    </div>
  );
}
