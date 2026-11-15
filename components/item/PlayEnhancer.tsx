'use client';
import { useEffect, useRef } from 'react';

// The play island (teen UI pass, 15 Nov 2026): progressive enhancement over the plain GET form, which
// stays the no-JavaScript path and the fallback if anything here fails. Submitting fetches the item's own
// URL — the server still checks the answer, still records it for a signed-in profile (the fetch is
// same-origin, so the recording gate in lib/accounts/record-play.ts sees exactly the request it expects) —
// and swaps the returned panel in place, so the verdict arrives without a page reload. The URL gains the
// same ?response and #result the form would have produced, and focus lands on the result block, matching
// the contract the accessibility suite pins. Taps also mark the chosen option (.selected, styled but until
// now unreachable) and, for put_in_order, assign positions by tapping rows in order; the selects remain
// the real controls, so keyboard play is untouched.
export default function PlayEnhancer({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const badge = (select: HTMLSelectElement) => {
      const label = select.closest('.option');
      if (!label) return;
      let el = label.querySelector<HTMLElement>('.order-badge');
      if (!el) {
        el = document.createElement('span');
        el.className = 'order-badge';
        el.setAttribute('aria-hidden', 'true');
        label.appendChild(el);
      }
      el.textContent = select.value ? select.value : '';
      label.classList.toggle('selected', Boolean(select.value));
    };

    const initPanel = (panel: Element) => {
      panel.querySelectorAll<HTMLSelectElement>('select[name^="pos-"]').forEach(badge);
      panel.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked').forEach((radio) => {
        radio.closest('.option')?.classList.add('selected');
      });
    };

    const onChange = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement && target.type === 'radio') {
        const form = target.closest('form');
        form?.querySelectorAll(`input[name="${target.name}"]`).forEach((radio) => {
          radio.closest('.option')?.classList.toggle('selected', radio === target);
        });
      }
      if (target instanceof HTMLSelectElement && target.name.startsWith('pos-')) badge(target);
    };

    const onClick = (e: MouseEvent) => {
      // Tap-to-rank: a tap on an ordering row (but not on its select, which keeps its own behaviour)
      // takes the next free position; tapping a placed row again clears it.
      if (e.target instanceof HTMLSelectElement || (e.target as HTMLElement).closest('select')) return;
      const label = (e.target as HTMLElement).closest('.option');
      const select = label?.querySelector<HTMLSelectElement>('select[name^="pos-"]');
      if (!label || !select) return;
      e.preventDefault(); // keep the label from also activating (opening) the select
      const form = select.closest('form');
      if (!form) return;
      const selects = Array.from(form.querySelectorAll<HTMLSelectElement>('select[name^="pos-"]'));
      if (select.value) {
        select.value = '';
      } else {
        const used = new Set(selects.map((s) => s.value).filter(Boolean));
        const next = selects.map((_, i) => String(i + 1)).find((n) => !used.has(n));
        if (next) select.value = next;
      }
      selects.forEach(badge);
    };

    const onSubmit = async (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!form.classList.contains('quiz-form')) return;
      e.preventDefault();
      const panel = form.closest('.quiz-panel');
      if (!panel) return;
      const url = new URL(form.action);
      new FormData(form).forEach((value, key) => {
        if (typeof value === 'string') url.searchParams.set(key, value);
      });
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      button?.setAttribute('disabled', '');
      panel.setAttribute('aria-busy', 'true');
      try {
        const res = await fetch(url, { headers: { accept: 'text/html' } });
        if (!res.ok) throw new Error('play fetch failed');
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const fresh = doc.querySelector('.quiz-panel');
        if (!fresh) throw new Error('no panel in response');
        const imported = document.importNode(fresh, true);
        panel.replaceWith(imported);
        history.pushState(null, '', `${url.pathname}${url.search}#result`);
        initPanel(imported);
        imported.querySelector<HTMLElement>('#result')?.focus();
      } catch {
        // Any failure returns the reader to the plain form path, which always works.
        button?.removeAttribute('disabled');
        panel.removeAttribute('aria-busy');
        form.submit();
      }
    };

    const panel = root.querySelector('.quiz-panel');
    if (panel) initPanel(panel);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    return () => {
      root.removeEventListener('change', onChange);
      root.removeEventListener('click', onClick);
      root.removeEventListener('submit', onSubmit);
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
