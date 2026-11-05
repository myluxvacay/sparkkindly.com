import type { CircleMember } from '@/lib/circles/repo';

// Current members by their circle name and role. Never an email: the view carries none.
export function MemberList({ members }: { members: CircleMember[] }) {
  return (
    <ul>
      {members.map((m, i) => (
        // Index keys: React keys reach the page payload, and other members' ids must not.
        <li key={i}>
          {m.name}
          {m.role === 'owner' ? ' (owner)' : ''}
          {m.isChild ? ' (child profile)' : ''}
          {m.isYou ? ' (you)' : ''}
        </li>
      ))}
    </ul>
  );
}
