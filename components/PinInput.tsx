// A labelled 4-digit PIN field: masked, numeric keypad, errors linked by id. Browsers ignore autocomplete=off on password
// fields, so a PIN being chosen is "new-password" and a PIN being entered is "one-time-code" (no saved password offered).
// An entered PIN also shows a visible "4 digits" hint and a title for the pattern message.
export function PinInput({
  id,
  label,
  entry = false,
  describedBy,
}: {
  id: string;
  label: string;
  entry?: boolean;
  describedBy: (string | undefined)[];
}) {
  const hint = entry ? `${id}-hint` : undefined;
  const ids = [hint, ...describedBy].filter(Boolean).join(' ');
  return (
    <p>
      <label htmlFor={id}>{label}</label>
      {hint && <span id={hint}>4 digits</span>}
      <input
        id={id}
        name={id}
        type="password"
        inputMode="numeric"
        autoComplete={entry ? 'one-time-code' : 'new-password'}
        pattern="[0-9]{4}"
        title={entry ? '4 digits' : undefined}
        minLength={4}
        maxLength={4}
        required
        aria-describedby={ids || undefined}
      />
    </p>
  );
}
