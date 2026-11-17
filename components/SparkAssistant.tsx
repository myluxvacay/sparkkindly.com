'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

// Spark, the SparkKindly guide (owner request #20, 17 Nov 2026; canonical cape design, owner-confirmed).
// Behaviour the owner settled: NO autoplay sound — Spark first does a silent attention loop (CSS wave/bounce/
// shimmer on the static image; the global reduced-motion rule in globals.css stills it), a greeting bubble
// appears after a short delay, and only a tap opens the panel and can play the voice greeting. Dismissal is
// remembered in localStorage. No third-party requests, no tracking, nothing is sent anywhere: the panel's
// guidance is fixed text and links to existing routes only — there is no open-ended chat here.
const DISMISS_KEY = 'sk-spark-dismissed';
const GREETING =
  'Hi, I’m Spark! A warm and curious welcome to SparkKindly. Think sharp. Be kind. Here you can play, discover, learn together, and grow, one small question at a time. Start with today’s question, try a quick quiz, or pick a world that catches your eye. Want me to show you around?';

export default function SparkAssistant() {
  const [hidden, setHidden] = useState(true); // stays hidden until the dismissal check runs, so a dismissed Spark never flashes
  const [bubble, setBubble] = useState(false);
  const [open, setOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      dismissed = false;
    }
    if (dismissed) return;
    const show = setTimeout(() => setHidden(false), 0);
    const t = setTimeout(() => setBubble(true), 1200);
    return () => {
      clearTimeout(show);
      clearTimeout(t);
    };
  }, []);

  if (hidden) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private-mode storage failure: Spark simply hides for this visit.
    }
    setHidden(true);
  };

  const toggle = () => {
    setOpen((o) => !o);
    setBubble(false);
  };

  return (
    <div className="spark-assistant">
      {open && (
        <section className="spark-panel" aria-label="Spark, your SparkKindly guide">
          <h2>Hi, I’m Spark!</h2>
          <p>{GREETING}</p>
          <p id="spark-listen-label">▶ Listen to Spark’s greeting — the words above are its full text:</p>
          {/* preload="none": the audio is fetched only when a visitor chooses to listen; native controls give play/pause. */}
          <audio ref={audioRef} controls src="/brand/spark-greeting.mp3" preload="none" aria-labelledby="spark-listen-label" />
          <nav aria-label="Spark’s tour">
            <ul className="spark-tour">
              <li><Link href="/quiz/">Today’s Question</Link></li>
              <li><Link href="/quiz/archive/">Try a Quiz</Link></li>
              <li><Link href="/games/">Picture Games with Spark</Link></li>
              <li><Link href="/#worlds">Pick a World</Link></li>
            </ul>
          </nav>
          <h3>Questions Spark can help with</h3>
          <ul className="spark-faq">
            <li><strong>What is SparkKindly?</strong> A daily question, stories and picture games across six worlds — Play, Discover, Together, Grow, Save and Kids.</li>
            <li><strong>Where do I start?</strong> Today’s Question is the front door. After that, pick whichever world catches your eye.</li>
            <li><strong>Is it for kids?</strong> The Kids world is for ages 6–9 with an adult alongside. Everything here is made to be kind and curious.</li>
          </ul>
          <button className="underlined spark-close-panel" onClick={toggle}>Close Spark’s panel</button>
        </section>
      )}
      {bubble && !open && (
        <p className="spark-bubble" role="status">
          Hi, I’m Spark! Tap me and I’ll show you around.
          <button className="spark-bubble-close" aria-label="Hide Spark’s greeting bubble" onClick={() => setBubble(false)}>×</button>
        </p>
      )}
      <div className="spark-figure-row">
        <button className="spark-figure" onClick={toggle} aria-expanded={open} aria-label={open ? 'Close Spark, your guide' : 'Open Spark, your guide'}>
          <img src="/brand/spark.webp" width={438} height={646} alt="Spark, the SparkKindly guide, waving hello" />
        </button>
        <button className="spark-dismiss" aria-label="Dismiss Spark for good" onClick={dismiss}>×</button>
      </div>
    </div>
  );
}
