'use client';
import { useEffect, useRef } from 'react';
import { detectFlick, pickCandidate } from '@/lib/play/keep-playing';
import {
  clearRead,
  isExhausted,
  loadRead,
  markRead,
  readIds,
  saveRead,
  type ReadStorage,
} from '@/lib/read/read-articles';
import { BAND_LABEL, reasonFor, type ReadDirection, type ReadNextModel } from '@/lib/read/read-next';
import { playSparkVoice } from '@/lib/games/spark-voice';

// The reading island (20 Nov 2026): progressive enhancement over the keep-reading panel's plain
// links, which stay the no-JavaScript path and the fallback if anything here fails. It mirrors the
// play island's keep-playing half (components/item/PlayEnhancer.tsx): a device read list with the
// same storage fallback chain, tap-time re-picking so a reader is dealt articles they have not read,
// provable-exhaustion states instead of silent repeats, and flick / double-tap gestures on the Spark
// band. Nothing here ever preventDefaults a touch, so ordinary scrolling is never hijacked — only a
// fast, deliberate flick counts.
//
// The child-safety carve-out is the quiz flow's, unchanged: when the model's trackRead is off
// (Kids-audience articles), this island never reads or writes browser storage at all. The panel then
// simply follows the server's candidates, whose per-article rotation provides the variety.
export default function ReadNextEnhancer({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const panel = root.querySelector<HTMLElement>('[data-kr]');
    if (!panel) return;

    const KR_HINT_KEY = 'sk-kr-hint-seen';

    // Where the device list lives: local storage first (it persists across visits), session storage
    // where local is unavailable, and a page-lifetime memory map as the last resort. The tracker
    // itself is pure and never throws, so reading survives every storage failure.
    const memoryStore = new Map<string, string>();
    const memoryBackend: ReadStorage = {
      getItem: (k) => memoryStore.get(k) ?? null,
      setItem: (k, v) => {
        memoryStore.set(k, v);
      },
      removeItem: (k) => {
        memoryStore.delete(k);
      },
    };
    let krBackend: ReadStorage | null = null;
    const krStorage = (): ReadStorage => {
      if (krBackend) return krBackend;
      for (const candidate of [window.localStorage, window.sessionStorage]) {
        try {
          candidate.setItem('sk-kr-probe', '1');
          candidate.removeItem('sk-kr-probe');
          krBackend = candidate;
          return candidate;
        } catch {
          // Try the next home for the list.
        }
      }
      krBackend = memoryBackend;
      return memoryBackend;
    };

    let model: ReadNextModel | null = null;
    try {
      model = panel.dataset.krModel ? (JSON.parse(panel.dataset.krModel) as ReadNextModel) : null;
    } catch {
      model = null;
    }
    if (!model) return;
    const theModel: ReadNextModel = model;

    // The read set this island plays against. On no-track surfaces (Kids articles) the device store
    // is never even read — the set is empty and the server's candidates rule, exactly as the quiz
    // flow's merged set reduces to the account history there (articles keep no account history).
    const krReadSet = (): Set<string> => (theModel.trackRead ? readIds(loadRead(krStorage())) : new Set<string>());

    // Every article presented in the reading flow is marked read on this device, so the next panel
    // down the chain prefers fresher shelves. Only where tracking is allowed (see the carve-out).
    if (theModel.trackRead) {
      const backend = krStorage();
      saveRead(backend, markRead(loadRead(backend), theModel.currentId, Date.now()));
    }

    // Reduced motion: Spark presents the choices as a still image, as in the assistant and the games.
    const img = panel.querySelector<HTMLImageElement>('[data-kr-still]');
    if (img?.dataset.krStill && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      img.src = img.dataset.krStill;
    }

    let hintSeen = false;
    try {
      hintSeen = sessionStorage.getItem(KR_HINT_KEY) === '1';
    } catch {
      // Keep the hint visible.
    }
    if (hintSeen) panel.querySelector<HTMLElement>('[data-kr-hint]')?.setAttribute('hidden', '');
    const krMarkHintSeen = () => {
      if (theModel.trackRead) {
        try {
          sessionStorage.setItem(KR_HINT_KEY, '1');
        } catch {
          // The hint simply stays; it is a one-line tip, not a gate.
        }
      }
      panel.querySelector<HTMLElement>('[data-kr-hint]')?.setAttribute('hidden', '');
    };

    type DirState = 'ok' | 'exhausted' | 'cycle' | null;
    const dirState = (dir: ReadDirection | 'next', read: ReadonlySet<string>): DirState => {
      const shelf =
        dir === 'next'
          ? { candidates: theModel.next, total: theModel.nextTotal }
          : theModel.options?.[dir]
            ? { candidates: theModel.options[dir].candidates, total: theModel.options[dir].total }
            : null;
      if (!shelf) return null;
      if (shelf.candidates.some((cand) => !read.has(cand.id))) return 'ok';
      return isExhausted(read, shelf.candidates.map((cand) => cand.id), shelf.total) ? 'exhausted' : 'cycle';
    };

    // Replace one direction's button with its completion note (the shelf is provably finished).
    const krShowExhausted = (dir: ReadDirection) => {
      const option = theModel.options?.[dir];
      const btn = panel.querySelector(`[data-kr-btn="${dir}"]`);
      if (!option || !btn) return;
      const note = document.createElement('span');
      note.className = 'kr-btn kr-btn-done';
      const label = document.createElement('span');
      label.className = 'kp-btn-label';
      label.textContent = `🎉 Every ${BAND_LABEL[option.band]} article read`;
      const sub = document.createElement('span');
      sub.className = 'kr-btn-sub';
      sub.textContent = 'You’ve read every article at this level';
      note.append(label, sub);
      btn.replaceWith(note);
    };

    // The recommended shelf is provably finished, but level choices remain: the card says so and
    // points at the buttons instead of silently repeating an article.
    const krShowCardDone = () => {
      const card = panel.querySelector('[data-kr-btn="next"]');
      if (!card) return;
      const done = document.createElement('div');
      done.className = 'kr-card kr-card-done';
      const body = document.createElement('span');
      body.className = 'kr-card-body';
      const title = document.createElement('span');
      title.className = 'kr-card-title';
      title.textContent = '🎉 You’ve read all of these';
      const sub = document.createElement('span');
      sub.className = 'kr-card-sub';
      sub.textContent = 'You’ve read every article on this shelf — try a level choice below, or browse the collection.';
      body.append(title, sub);
      done.append(body);
      card.replaceWith(done);
    };

    // Nothing left to deal on any shelf: the block becomes the congratulations state. The collection
    // link stays for deliberate re-reading, and the server-rendered Start fresh row stays as the reset.
    const krShowAllDone = () => {
      if (panel.querySelector('.kr-done')) return;
      const done = document.createElement('div');
      done.className = 'kr-done';
      const head = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = 'You’ve read everything here! 🎉';
      head.append(strong);
      const body = document.createElement('p');
      body.textContent =
        'That’s the whole shelf for now — new articles land every day. Browse the collection to re-read a favourite, or start fresh below.';
      done.append(head, body);
      panel.querySelector('[data-kr-btn="next"]')?.replaceWith(done);
      panel.querySelector('.kr-buttons')?.remove();
      panel.querySelector('[data-kr-hint]')?.remove();
    };

    // Apply the exhaustion states for the panel as it stands, and refresh the recommendation card to
    // the first article on its shelf this device has not read (the server's first pick may be one).
    const krRefresh = () => {
      if (!theModel.trackRead) return;
      const read = krReadSet();
      const dirs = ['easier', 'same', 'harder'] as ReadDirection[];
      const states = dirs.map((dir) => dirState(dir, read));
      const nextState = dirState('next', read);
      dirs.forEach((dir, i) => {
        if (states[i] === 'exhausted') krShowExhausted(dir);
      });
      if (nextState === 'exhausted' && states.every((s) => s === null || s === 'exhausted')) {
        krShowAllDone();
        return;
      }
      if (nextState === 'exhausted') {
        krShowCardDone();
      } else {
        const pick = pickCandidate(theModel.next, read);
        const card = panel.querySelector<HTMLAnchorElement>('[data-kr-btn="next"]');
        if (pick && card && pick.candidate.id !== theModel.primary?.id) {
          const fresh = theModel.next.find((cand) => cand.id === pick.candidate.id);
          if (fresh) {
            card.href = fresh.href;
            const cardImg = card.querySelector<HTMLImageElement>('[data-kr-card-img]');
            if (cardImg) cardImg.src = fresh.image?.src ?? `/api/template-image${fresh.href}`;
            const cardTitle = card.querySelector('[data-kr-card-title]');
            if (cardTitle) cardTitle.textContent = fresh.title;
            const cardSub = card.querySelector('[data-kr-card-sub]');
            if (cardSub) cardSub.textContent = reasonFor(theModel.currentTopics, fresh);
          }
        }
      }
      if (states[1] === 'exhausted' && states[2] === 'ok') {
        const up = panel.querySelector<HTMLElement>('[data-kr-btn="harder"]');
        up?.classList.add('kr-btn-next');
        const sub = up?.querySelector('.kr-btn-sub');
        if (sub) sub.textContent = 'The next level up — start here';
      }
    };
    krRefresh();

    const krNavigate = (dir: ReadDirection) => {
      const option = theModel.options?.[dir];
      if (!option) return;
      const read = krReadSet();
      const pick = pickCandidate(option.candidates, read);
      if (!pick) return;
      if (pick.exhausted && isExhausted(read, option.candidates.map((cand) => cand.id), option.total)) {
        // Provably finished: show the completion state instead of silently repeating an article.
        krRefresh();
        return;
      }
      // Otherwise there is an unread candidate (pick), or the pool in hand was truncated so the
      // shelf cannot be proven finished and cycles — never a dead end.
      krMarkHintSeen();
      window.location.assign(pick.candidate.href);
    };

    // Start fresh is the visitor's deliberate reset: it clears ONLY this device's read list.
    const krStartFresh = () => {
      clearRead(krStorage());
      window.location.reload();
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Spark's tap-to-play voice: the greeting line, from the reader's own tap — the one moment a
      // clip may play outside an answer (the assistant's rule, lib/games/spark-voice).
      if (target.closest('[data-kr-voice]')) {
        playSparkVoice('greeting');
        return;
      }
      if (target.closest('[data-kr-fresh]')) {
        e.preventDefault();
        krStartFresh();
        return;
      }
      // Level buttons: re-pick against the read set before following the link. The recommendation
      // card ('next') is left alone — krRefresh already dealt it an unread article at mount.
      const btn = target.closest<HTMLElement>('[data-kr-btn]');
      if (!btn) return;
      const dir = btn.dataset.krBtn as ReadDirection | 'next';
      if (dir === 'easier' || dir === 'same' || dir === 'harder') {
        e.preventDefault();
        krNavigate(dir);
      }
    };

    // Keep-reading gestures, on the Spark band only: flick up → harder, flick down → easier,
    // double-tap → the recommended next article. Touches starting on anything interactive (the
    // Spark voice button, links, buttons) are left alone, and no touch is ever preventDefaulted,
    // so page scrolling behaves exactly as before.
    let touchStart: { x: number; y: number; t: number } | null = null;
    let lastTap: { t: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchStart = null;
      const target = e.target as HTMLElement;
      if (target.closest('a, button, input, select, textarea, label, summary')) return;
      if (!target.closest('[data-kr-flick]')) return;
      const touch = e.changedTouches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!touchStart) return;
      const start = touchStart;
      touchStart = null;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const durationMs = Date.now() - start.t;
      const flick = detectFlick({ dx, dy, durationMs });
      if (flick) {
        lastTap = null;
        krNavigate(flick === 'up' ? 'harder' : 'easier');
        return;
      }
      // Double-tap: two short, still taps on the band in quick succession → the next article.
      if (durationMs <= 300 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
        if (lastTap && Date.now() - lastTap.t <= 350) {
          lastTap = null;
          krMarkHintSeen();
          const href = panel.querySelector<HTMLAnchorElement>('[data-kr-btn="next"]')?.href;
          if (href) window.location.assign(href);
        } else {
          lastTap = { t: Date.now() };
        }
      }
    };

    root.addEventListener('click', onClick);
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
