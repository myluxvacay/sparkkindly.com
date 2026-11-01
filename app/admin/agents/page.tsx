import ActionForm from '@/components/admin/ActionForm';
import StatusNote from '@/components/admin/StatusNote';
import { requireAdmin } from '@/lib/admin/next';
import { listAgents, listWorldsAdmin } from '@/lib/admin/queries';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ done?: string; error?: string }> };
const BACK = '/admin/agents/';

export default async function AdminAgentsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const db = getDb();
  const [agents, worlds] = await Promise.all([listAgents(db), listWorldsAdmin(db)]);
  return (
    <>
      <h1>Agents and keys</h1>
      <StatusNote done={done} error={error} />
      <p>Rotate every key at least every 90 days. A rotated or revoked key stops working at once.</p>
      <ul className="admin-list">
        {agents.map((a) => {
          return (
            <li key={a.id}>
              <h2>{a.name}</h2>
              <p className="muted">
                {a.world ?? 'master (any world)'} · {a.enabled ? 'enabled' : 'revoked'} · last run{' '}
                {a.lastRunAt ? new Date(a.lastRunAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'never'}
                {a.keyAgeDays >= 90 ? ` · key is ${a.keyAgeDays} days old: rotate it` : ` · key ${a.keyAgeDays} days old`}
              </p>
              <div className="admin-actions">
                <ActionForm csrf={admin.csrf} action="agent.rotate" returnTo={BACK} label="Rotate key" ariaLabel={`Rotate key: ${a.name}`} fields={{ id: String(a.id) }} />
                <ActionForm
                  csrf={admin.csrf}
                  action="agent.enabled"
                  returnTo={BACK}
                  label={a.enabled ? 'Revoke' : 'Re-enable'}
                  ariaLabel={`${a.enabled ? 'Revoke' : 'Re-enable'}: ${a.name}`}
                  fields={{ id: String(a.id), enabled: String(!a.enabled) }}
                  plain
                />
              </div>
            </li>
          );
        })}
      </ul>
      <section aria-labelledby="new-agent">
        <h2 id="new-agent">Create an agent</h2>
        <form method="post" action="/admin/act/" className="admin-form">
          <input type="hidden" name="csrf" value={admin.csrf} />
          <input type="hidden" name="action" value="agent.create" />
          <input type="hidden" name="return" value={BACK} />
          <p>
            <label htmlFor="agent-name">Name (lowercase letters, digits and hyphens)</label>
            <input id="agent-name" name="name" required maxLength={40} />
          </p>
          <p>
            <label htmlFor="agent-world">World</label>
            <select id="agent-world" name="world" defaultValue="">
              <option value="">Master agent (names the world on each request)</option>
              {worlds.map((w) => (
                <option key={w.slug} value={w.slug}>
                  {w.name}
                </option>
              ))}
            </select>
          </p>
          <button type="submit" className="button">
            Create agent
          </button>
        </form>
      </section>
    </>
  );
}
