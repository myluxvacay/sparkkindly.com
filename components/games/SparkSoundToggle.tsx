'use client';
import { useEffect, useState } from 'react';
import { SPARK_SOUND_KEY } from '@/lib/games/spark-voice';

// The visible switch for Spark's recorded voice (the toggle that has governed game sound since
// 17 Nov 2026, kept when the picture games moved into the question flow): default on, persisted in
// localStorage under the shared key every Spark clip checks before it plays.
export default function SparkSoundToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setOn(localStorage.getItem(SPARK_SOUND_KEY) !== 'off');
      } catch {
        // Keep the default (on) if storage is unreachable.
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const toggle = () => {
    setOn((was) => {
      try {
        localStorage.setItem(SPARK_SOUND_KEY, was ? 'off' : 'on');
      } catch {
        // Private-mode storage failure: the toggle still works for this visit.
      }
      return !was;
    });
  };

  return (
    <button className="vg-sound-toggle" aria-pressed={on} onClick={toggle}>
      {on ? "🔊 Spark's voice: on" : "🔇 Spark's voice: off"}
    </button>
  );
}
