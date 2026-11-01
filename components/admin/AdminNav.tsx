import Link from 'next/link';
import ActionForm from './ActionForm';

const LINKS: [string, string][] = [
  ['/admin/', 'Queue'],
  ['/admin/items/', 'Items'],
  ['/admin/reports/', 'Reports'],
  ['/admin/worlds/', 'Worlds'],
  ['/admin/topics/', 'Topics'],
  ['/admin/agents/', 'Agents'],
  ['/admin/runs/', 'Runs'],
  ['/admin/digest/', 'Digest'],
];

export default function AdminNav({ email, csrf }: { email: string; csrf: string }) {
  return (
    <nav aria-label="Admin" className="admin-nav">
      <ul>
        {LINKS.map(([href, label]) => (
          <li key={href}>
            <Link href={href}>{label}</Link>
          </li>
        ))}
      </ul>
      <p className="muted">
        Signed in as {email}.{' '}
        <ActionForm csrf={csrf} action="session.end" returnTo="/admin/sign-in/" label="Sign out" plain />
      </p>
    </nav>
  );
}
