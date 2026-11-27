'use client';
// "Add SparkKindly to your home screen" card on the Hub home (Phase 2.5). Uses the
// captured beforeinstallprompt where the browser offers one; on iOS Safari (which never
// fires it) it shows the Share → Add to Home Screen steps instead. Hidden when the site
// is already running installed (standalone) and once dismissed — the dismissal is one
// localStorage flag on an adult's own device (the Kids no-storage rule covers kid
// surfaces, not a signed-in adult's Hub home). State lives in a tiny external store so
// the card renders nothing on the server and the right thing on the client.
import { useSyncExternalStore } from 'react';

const DISMISS_KEY = 'sk-hub-install-dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
type Mode = 'hidden' | 'prompt' | 'ios';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  const onPrompt = (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  };
  const onInstalled = () => {
    deferredPrompt = null;
    emit();
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
  };
};

const isIos = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

const snapshot = (): Mode => {
  if (isStandalone()) return 'hidden';
  try {
    if (localStorage.getItem(DISMISS_KEY) === '1') return 'hidden';
  } catch {
    // Storage unavailable: still offer the install; dismissal just won't stick.
  }
  if (deferredPrompt) return 'prompt';
  if (isIos()) return 'ios';
  return 'hidden';
};

const dismiss = (): void => {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // As above: hiding for this view is enough.
  }
  emit();
};

export default function HubInstallCard() {
  const mode = useSyncExternalStore(subscribe, snapshot, () => 'hidden' as Mode);
  if (mode === 'hidden') return null;

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      deferredPrompt = null;
      emit();
    }
  };

  return (
    <section aria-label="Install SparkKindly" style={{ border: '2px solid #5b2c6f', borderRadius: 8, padding: 12, margin: '12px 0' }}>
      <h2 style={{ marginTop: 0 }}>Add SparkKindly to your home screen</h2>
      {mode === 'ios' ? (
        <p>
          On this iPhone or iPad: tap the <strong>Share</strong> button in Safari, then <strong>Add to Home Screen</strong>. SparkKindly
          then opens like an app, straight into your Family Hub — and run alerts can reach you.
        </p>
      ) : (
        <p>Install SparkKindly as an app: it opens straight into your Family Hub, and run alerts can reach you.</p>
      )}
      <p style={{ marginBottom: 0 }}>
        {mode === 'prompt' && (
          <>
            <button type="button" onClick={install}>
              Install
            </button>{' '}
          </>
        )}
        <button type="button" onClick={dismiss}>
          Not now
        </button>
      </p>
    </section>
  );
}
