// A labelled 4-digit PIN field: masked, numeric keypad, never autofilled or remembered, errors linked by id.
export function PinInput({ id, label, describedBy }: { id: string; label: string; describedBy: (string | undefined)[] }) {
  const ids = describedBy.filter(Boolean).join(' ');
  return (
    <p>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{4}"
        minLength={4}
        maxLength={4}
        required
        aria-describedby={ids || undefined}
      />
    </p>
  );
}
