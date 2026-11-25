'use client';
import { useEffect, useRef } from 'react';
import {
  detectFlick,
  pickCandidate,
  DIFFICULTY_LABEL,
  DIFFICULTY_ORDER,
  type KeepPlayDirection,
  type KeepPlayModel,
} from '@/lib/play/keep-playing';
import {
  clearSeen,
  isExhausted,
  loadSeen,
  markSeen,
  mergeSeenIds,
  saveSeen,
  seenIds,
  type SeenStorage,
} from '@/lib/play/seen-quizzes';
import { playSparkVoice } from '@/lib/games/spark-voice';
import { bandMatches, type AgeBand } from '@/lib/age-bands';
import { loadAgeBand } from '@/lib/age-band-client';
import type { Difficulty } from '@/lib/public/body';

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
      kpMarkPresented(panel);
      initKeepPlaying(panel);
      initDaily(panel);
    };

    // --- "Keep playing" (17 Nov 2026): the seen-questions memory + next-quiz picking + gestures.
    // The buttons are plain links to the server's first candidate, so they work untouched without this
    // code; the island's job is to deal only questions the visitor has not been shown. "Seen" is the
    // merged set (lib/play/seen-quizzes): this device's persistent memory ∪, for a signed-in player,
    // the account's saved answers (the server embeds the relevant ids in the model). Everything is
    // delegated from this root, so it survives the panel swap above. Nothing here ever preventDefaults
    // a touch, so ordinary scrolling is never hijacked — only a fast, deliberate flick counts.
    const KP_HINT_KEY = 'sk-kp-hint-seen';

    // Where the device list lives: local storage first (it persists across visits), session storage
    // where local is unavailable, and a page-lifetime memory map as the last resort. The tracker
    // itself is pure and never throws, so play survives every storage failure.
    const memoryStore = new Map<string, string>();
    const memoryBackend: SeenStorage = {
      getItem: (k) => memoryStore.get(k) ?? null,
      setItem: (k, v) => {
        memoryStore.set(k, v);
      },
      removeItem: (k) => {
        memoryStore.delete(k);
      },
    };
    let kpBackend: SeenStorage | null = null;
    const kpStorage = (): SeenStorage => {
      if (kpBackend) return kpBackend;
      for (const candidate of [window.localStorage, window.sessionStorage]) {
        try {
          candidate.setItem('sk-kp-probe', '1');
          candidate.removeItem('sk-kp-probe');
          kpBackend = candidate;
          return candidate;
        } catch {
          // Try the next home for the list.
        }
      }
      kpBackend = memoryBackend;
      return memoryBackend;
    };

    const kpModel = (panel: Element): KeepPlayModel | null => {
      const raw = panel.querySelector<HTMLElement>('[data-kp]')?.dataset.kpModel;
      if (!raw) return null;
      try {
        return JSON.parse(raw) as KeepPlayModel;
      } catch {
        return null;
      }
    };
    const kpMarkHintSeen = (panel: Element, persist: boolean) => {
      if (persist) {
        try {
          sessionStorage.setItem(KP_HINT_KEY, '1');
        } catch {
          // The hint simply stays; it is a one-line tip, not a gate.
        }
      }
      panel.querySelector<HTMLElement>('[data-kp-hint]')?.setAttribute('hidden', '');
    };

    // Every quiz presented in the play flow is marked seen on this device — today's quiz, archive
    // picks and every keep-playing hop alike. The panel carries its id + level as data attributes.
    function kpMarkPresented(panel: Element) {
      const el = panel as HTMLElement;
      const id = el.dataset.kpCurrent;
      const level = el.dataset.kpLevel;
      if (!id || !level || !(DIFFICULTY_ORDER as readonly string[]).includes(level)) return;
      const backend = kpStorage();
      saveSeen(backend, markSeen(loadSeen(backend), id, level as Difficulty, Date.now()));
    }

    // On no-track surfaces (Kids questions, the daily-question pages) the device store is never even
    // read — the merged set is the account history alone, which lives server-side already.
    const kpMergedSeen = (model: KeepPlayModel): Set<string> =>
      model.trackSeen ? mergeSeenIds(seenIds(loadSeen(kpStorage())), model.accountSeen) : new Set(model.accountSeen);

    type KpDirState = 'ok' | 'exhausted' | 'cycle' | null;
    const kpDirState = (model: KeepPlayModel, dir: KeepPlayDirection, seen: ReadonlySet<string>): KpDirState => {
      const option = model.options[dir];
      if (!option) return null;
      if (option.candidates.some((cand) => !seen.has(cand.id))) return 'ok';
      return isExhausted(seen, option.candidates.map((cand) => cand.id), option.total) ? 'exhausted' : 'cycle';
    };

    // Replace one direction's button with its completion note (the level is provably finished).
    const kpShowExhausted = (panel: Element, dir: KeepPlayDirection, model: KeepPlayModel) => {
      const option = model.options[dir];
      const btn = panel.querySelector(`[data-kp-btn="${dir}"]`);
      if (!option || !btn) return;
      const note = document.createElement('span');
      note.className = 'kp-btn kp-btn-done';
      const label = document.createElement('span');
      label.className = 'kp-btn-label';
      label.textContent = `🎉 Every ${DIFFICULTY_LABEL[option.level]} question played`;
      const sub = document.createElement('span');
      sub.className = 'kp-btn-sub';
      sub.textContent = 'You’ve played every question at this level';
      note.append(label, sub);
      btn.replaceWith(note);
    };

    // Nothing left to deal at any level: the block becomes the congratulations state. The archive
    // stays for deliberate replay, and the server-rendered Start fresh row below stays as the reset.
    const kpShowAllDone = (panel: Element, model: KeepPlayModel) => {
      const block = panel.querySelector('[data-kp]');
      if (!block || block.querySelector('.kp-done')) return;
      const done = document.createElement('div');
      done.className = 'kp-done';
      const head = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = 'You’ve played every question! 🎉';
      head.append(strong);
      const body = document.createElement('p');
      body.textContent = model.trackSeen
        ? 'That’s the whole shelf for now — new questions land every day. Browse the archive to replay any favourite, or start fresh below.'
        : 'That’s the whole shelf for now — new questions land every day. Browse the archive to replay any favourite.';
      done.append(head, body);
      if (model.signedIn && model.trackSeen) {
        const note = document.createElement('p');
        note.textContent = 'Start fresh clears only this device’s list — your saved answers and scores stay.';
        done.append(note);
      }
      block.querySelector('.kp-buttons')?.replaceWith(done);
      block.querySelector('[data-kp-hint]')?.remove();
    };

    // Apply the exhaustion states for the panel as it stands: finished levels show their completion
    // note, a finished home level points at the next level up, and a finished everything shows the
    // congratulations state.
    const kpRefreshExhaustion = (panel: Element) => {
      const model = kpModel(panel);
      if (!model) return;
      const seen = kpMergedSeen(model);
      const dirs = ['easier', 'same', 'harder'] as KeepPlayDirection[];
      const states = dirs.map((dir) => kpDirState(model, dir, seen));
      dirs.forEach((dir, i) => {
        if (states[i] === 'exhausted') kpShowExhausted(panel, dir, model);
      });
      if (states.every((s) => s === null || s === 'exhausted') && states.some((s) => s === 'exhausted')) {
        kpShowAllDone(panel, model);
        return;
      }
      if (states[1] === 'exhausted' && states[2] === 'ok') {
        const up = panel.querySelector<HTMLElement>('[data-kp-btn="harder"]');
        up?.classList.add('kp-btn-next');
        const sub = up?.querySelector('.kp-btn-sub');
        if (sub) sub.textContent = 'The next level up — start here';
      }
    };

    function initKeepPlaying(panel: Element) {
      const model = kpModel(panel);
      if (!model) return;
      let hintSeen = false;
      try {
        hintSeen = sessionStorage.getItem(KP_HINT_KEY) === '1';
      } catch {
        // Keep the hint visible.
      }
      if (hintSeen) panel.querySelector<HTMLElement>('[data-kp-hint]')?.setAttribute('hidden', '');
      // Reduced motion: Spark presents the choices as a still image, as in the picture games.
      const img = panel.querySelector<HTMLImageElement>('[data-kp-still]');
      if (img?.dataset.kpStill && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        img.src = img.dataset.kpStill;
      }
      kpRefreshExhaustion(panel);
    }

    const kpNavigate = (panel: Element, dir: KeepPlayDirection) => {
      const model = kpModel(panel);
      const option = model?.options[dir];
      if (!model || !option) return;
      const seen = kpMergedSeen(model);
      const pick = pickCandidate(option.candidates, seen);
      if (!pick) return;
      if (pick.exhausted && isExhausted(seen, option.candidates.map((cand) => cand.id), option.total)) {
        // Provably finished: show the completion state instead of silently repeating a question.
        kpRefreshExhaustion(panel);
        return;
      }
      // Otherwise there is an unseen candidate (pick), or the pool in hand was truncated so the level
      // cannot be proven finished and cycles — never a dead end.
      kpMarkHintSeen(panel, model.trackSeen);
      window.location.assign(pick.candidate.href);
    };

    // Start fresh is the visitor's deliberate reset: it clears ONLY this device's seen list. A
    // signed-in player's saved answers and scores are never touched — the reload simply re-deals
    // against whatever seen-set remains.
    const kpStartFresh = () => {
      clearSeen(kpStorage());
      window.location.reload();
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
      // Start fresh: the deliberate reset of this device's seen list (never the account's history).
      if ((e.target as HTMLElement).closest('[data-kp-fresh]')) {
        e.preventDefault();
        kpStartFresh();
        return;
      }
      // Keep-playing buttons: re-pick against the merged seen-set before following the link.
      const kpBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-kp-btn]');
      if (kpBtn) {
        const panel = kpBtn.closest('.quiz-panel');
        const dir = kpBtn.dataset.kpBtn as KeepPlayDirection;
        if (panel && (dir === 'easier' || dir === 'same' || dir === 'harder')) {
          e.preventDefault();
          kpNavigate(panel, dir);
          return;
        }
      }
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
        const imported = document.importNode(fresh, true) as HTMLElement;
        // The answer was submitted from a daily surface: the fetched item page carries no daily
        // model, so carry this panel's model over — the result panel then marks the question
        // seen under the daily rules in initDaily (initPanel below).
        const dailyRaw = (panel as HTMLElement).dataset.dailyModel;
        if (dailyRaw) {
          imported.dataset.dailyModel = dailyRaw;
          const dailyCurrent = (panel as HTMLElement).dataset.dailyCurrent;
          if (dailyCurrent) imported.dataset.dailyCurrent = dailyCurrent;
          imported.removeAttribute('data-kp-current');
          imported.removeAttribute('data-kp-level');
        }
        panel.replaceWith(imported);
        history.pushState(null, '', `${url.pathname}${url.search}#result`);
        initPanel(imported);
        // Spark's recorded voice (owner lines, 18 Nov 2026): the verdict arrived as the direct
        // result of the player's own answer submission — the one moment a clip may play in this
        // flow. Praise for a correct answer, the completion line when this answer finished the
        // whole shelf (the island just marked it .kp-done), encouragement for a miss. The shared
        // sound toggle governs it; a page load or a no-JS submit never plays anything.
        const verdict = imported.querySelector('.quiz-result h2')?.textContent ?? '';
        if (verdict.startsWith('Correct')) {
          playSparkVoice(imported.querySelector('.kp-done') ? 'completion' : 'praise');
        } else if (verdict) {
          playSparkVoice('encouragement');
        }
        imported.querySelector<HTMLElement>('#result')?.focus();
      } catch {
        // Any failure returns the reader to the plain form path, which always works.
        button?.removeAttribute('disabled');
        panel.removeAttribute('aria-busy');
        form.submit();
      }
    };

    // --- Today's Spark advance (owner addendum, 24 Nov 2026). The daily surfaces embed a chain
    // model on the panel (data-daily-model / data-daily-current, built server-side in
    // lib/play/daily-quiz.ts). A panel showing a result marks the current question seen on this
    // device — unless its audience is 'kids', where the device store is NEVER read or written
    // (the Kids carve-out stands; signed-in history alone, in accountSeen, serves those). A
    // fresh panel whose current question is already seen (account ∪ device, same carve-out)
    // swaps in the next unanswered question, band-matching ones first.
    type DailyEntry = { id: string; world: string; slug: string; title: string; bands: string[]; difficulty: string | null; audience: string };
    type DailyModelShape = { chain: DailyEntry[]; accountSeen: string[] };
    const dailyModelOf = (panel: Element): DailyModelShape | null => {
      const raw = (panel as HTMLElement).dataset.dailyModel;
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as DailyModelShape;
        return Array.isArray(parsed.chain) && Array.isArray(parsed.accountSeen) ? parsed : null;
      } catch {
        return null;
      }
    };

    function initDaily(panel: Element) {
      const model = dailyModelOf(panel);
      const currentId = (panel as HTMLElement).dataset.dailyCurrent;
      if (!model || !currentId) return;
      const current = model.chain.find((c) => c.id === currentId);
      if (panel.querySelector('.quiz-result')) {
        // Answered: remember it on this device so a reload / return visit advances. Kids-audience
        // questions never touch the device store.
        if (current?.audience !== 'kids') {
          const level =
            current?.difficulty && (DIFFICULTY_ORDER as readonly string[]).includes(current.difficulty)
              ? (current.difficulty as Difficulty)
              : 'medium';
          const backend = kpStorage();
          saveSeen(backend, markSeen(loadSeen(backend), currentId, level, Date.now()));
        }
        return;
      }
      void dailyAdvance(panel, model, currentId, current?.audience);
    }

    async function dailyAdvance(panel: Element, model: DailyModelShape, currentId: string, audience: string | undefined) {
      const el = panel as HTMLElement;
      if (el.dataset.dailyAdvancing) return;
      const merged = new Set<string>(model.accountSeen);
      if (audience !== 'kids') {
        for (const id of seenIds(loadSeen(kpStorage()))) merged.add(id);
      }
      const stored = loadAgeBand();
      if (!merged.has(currentId)) {
        // Band-first on FIRST load (owner addendum, 24 Nov 2026): the served question has not been
        // answered, but if it does not suit the visitor's stored band and an unseen band-matching
        // question exists in the chain, lead with that one instead. Read-only: this path never
        // writes storage — the band was already the visitor's stored choice, and the seen sets
        // change only when a question is answered. Loop safety: the swap target bandMatches the
        // stored band and is not in the merged seen set, so when initPanel re-runs initDaily on
        // the swapped panel neither this trigger nor the answered trigger below can fire again.
        if (!stored || stored === 'all') return; // no band picked (or unfiltered exploring)
        const band = stored as AgeBand;
        const current = model.chain.find((c) => c.id === currentId);
        if (!current || bandMatches(current.bands as AgeBand[], band)) return;
        const candidate = model.chain.find(
          (c) => c.id !== currentId && !merged.has(c.id) && bandMatches(c.bands as AgeBand[], band),
        );
        if (!candidate) return;
        await swapDaily(panel, model, candidate);
        return;
      }
      let ordered = model.chain;
      if (stored && stored !== 'all' && stored !== 'family') {
        const band = stored as AgeBand;
        const hits = (c: DailyEntry) => bandMatches(c.bands as AgeBand[], band);
        ordered = [...model.chain.filter(hits), ...model.chain.filter((c) => !hits(c))];
      }
      const candidate = ordered.find((c) => c.id !== currentId && !merged.has(c.id));
      if (!candidate) return;
      await swapDaily(panel, model, candidate);
    }

    // The one swap path for the daily chain: fetch the candidate's item page, take its panel,
    // carry the daily model over with the candidate as current, and re-initialise. Used by the
    // answered advance and the band-first first-load lead alike.
    async function swapDaily(panel: Element, model: DailyModelShape, candidate: DailyEntry) {
      const el = panel as HTMLElement;
      el.dataset.dailyAdvancing = '1';
      try {
        const res = await fetch(`/${candidate.world}/${candidate.slug}/`, { headers: { accept: 'text/html' } });
        if (!res.ok) return;
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const fresh = doc.querySelector('.quiz-panel');
        if (!fresh) return;
        const imported = document.importNode(fresh, true) as HTMLElement;
        // The fetched item page knows nothing of the daily chain: copy the model onto the new
        // panel, and strip the keep-playing presented markers — a daily question counts as seen
        // only when answered (above), never merely for being shown.
        imported.dataset.dailyModel = JSON.stringify(model);
        imported.dataset.dailyCurrent = candidate.id;
        imported.removeAttribute('data-kp-current');
        imported.removeAttribute('data-kp-level');
        panel.replaceWith(imported);
        const titleEl = document.querySelector('[data-daily-title]');
        if (titleEl) titleEl.textContent = candidate.title;
        initPanel(imported);
      } catch {
        // Any failure leaves the server-rendered question in place, which always works.
      }
    }

    // Keep-playing gestures, on the result hotspot only (the verdict block + the keep-playing block):
    // flick up → harder, flick down → easier, double-tap → same level. Touches starting on anything
    // interactive (links, buttons, form controls) are left alone, and no touch is ever preventDefaulted,
    // so page scrolling behaves exactly as before.
    let touchStart: { x: number; y: number; t: number; panel: Element } | null = null;
    let lastTap: { t: number; panel: Element } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchStart = null;
      const target = e.target as HTMLElement;
      if (target.closest('a, button, input, select, textarea, label, summary')) return;
      const panel = target.closest('.quiz-panel');
      if (!panel || !panel.querySelector('[data-kp]')) return;
      if (!target.closest('.quiz-result, [data-kp]')) return;
      const touch = e.changedTouches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, t: Date.now(), panel };
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
        kpNavigate(start.panel, flick === 'up' ? 'harder' : 'easier');
        return;
      }
      // Double-tap: two short, still taps on the hotspot in quick succession.
      if (durationMs <= 300 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
        if (lastTap && lastTap.panel === start.panel && Date.now() - lastTap.t <= 350) {
          lastTap = null;
          kpNavigate(start.panel, 'same');
        } else {
          lastTap = { t: Date.now(), panel: start.panel };
        }
      }
    };

    const panel = root.querySelector('.quiz-panel');
    if (panel) initPanel(panel);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      root.removeEventListener('change', onChange);
      root.removeEventListener('click', onClick);
      root.removeEventListener('submit', onSubmit);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
