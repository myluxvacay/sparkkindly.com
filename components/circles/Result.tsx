// The outcome message after a circle POST, from the ?r= code. Unknown codes show nothing.
export type Messages = Record<string, { text: string; ok: boolean }>;

export function Result({ code, messages }: { code?: string; messages: Messages }) {
  const r = code && Object.hasOwn(messages, code) ? messages[code] : undefined;
  if (!r) return null;
  return (
    <div role={r.ok ? 'status' : 'alert'} id="result" tabIndex={-1} className={r.ok ? 'takeaway' : 'grown-ups'}>
      <p>{r.text}</p>
    </div>
  );
}
