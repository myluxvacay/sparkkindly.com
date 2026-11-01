// One admin action button: a plain POST form to /admin/act/ carrying the CSRF token, the action name, the return path
// and any fixed fields. Works without JavaScript.
type Props = {
  csrf: string;
  action: string;
  returnTo: string;
  label: string;
  fields?: Record<string, string>;
  plain?: boolean;
  children?: React.ReactNode;
};

export default function ActionForm({ csrf, action, returnTo, label, fields = {}, plain, children }: Props) {
  return (
    <form method="post" action="/admin/act/" className="admin-action">
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="return" value={returnTo} />
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <button type="submit" className={plain ? 'text-button' : 'button'}>
        {label}
      </button>
    </form>
  );
}
