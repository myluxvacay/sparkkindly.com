'use client';

// Shown when a page cannot be built, for example when the database is unreachable. Never shows the error itself.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container section not-found">
      <p className="eyebrow">A LITTLE HICCUP</p>
      <h1>Something went wrong on our side.</h1>
      <p>Please try again in a moment.</p>
      <button type="button" className="button" onClick={() => reset()}>Try again</button>
    </div>
  );
}
