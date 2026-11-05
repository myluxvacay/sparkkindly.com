import Link from 'next/link';
import { commentsEnabled } from '@/lib/config';
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
  ['/admin/circles/', 'Circles'],
  ['/admin/pilot/', 'Pilot'],
];

export default function AdminNav({ email, csrf }: { email: string; csrf: string }) {
  // The comments page exists only with comments switched on (plan 7A).
  const links: [string, string][] = commentsEnabled() ? [...LINKS, ['/admin/comments/', 'Comments']] : LINKS;
  return (
    <nav aria-label="Admin" className="admin-nav">
      <ul>
        {links.map(([href, label]) => (
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
