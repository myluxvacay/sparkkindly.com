// The contribution state machine (plan 8): every legal move, and nothing else. Only the owner's admin action can take a
// contribution from needs_owner to approved; the reviewer agent can at most reach needs_owner. Pure, no I/O.
// Verified by tests/unit/contributors-rules.test.ts.

export const STATES = [
  'draft',
  'submitted',
  'agent_review',
  'needs_owner',
  'changes_requested',
  'approved',
  'rejected',
  'withdrawn',
] as const;
export type State = (typeof STATES)[number];

export const EVENTS = [
  'save',
  'submit',
  'gates_pass',
  'gates_fail',
  'review_pass',
  'review_fail',
  'approve',
  'request_changes',
  'reject',
  'withdraw',
] as const;
export type Event = (typeof EVENTS)[number];

const MOVES: Record<State, Partial<Record<Event, State>>> = {
  draft: { save: 'draft', submit: 'submitted', withdraw: 'withdrawn' },
  submitted: { gates_pass: 'agent_review', gates_fail: 'draft', withdraw: 'withdrawn' },
  agent_review: { review_pass: 'needs_owner', review_fail: 'changes_requested', withdraw: 'withdrawn' },
  needs_owner: { approve: 'approved', request_changes: 'changes_requested', reject: 'rejected', withdraw: 'withdrawn' },
  changes_requested: { save: 'changes_requested', submit: 'submitted', withdraw: 'withdrawn' },
  approved: { withdraw: 'withdrawn' },
  rejected: { withdraw: 'withdrawn' },
  withdrawn: {},
};

export function nextState(state: State, event: Event): State | null {
  return Object.hasOwn(MOVES, state) ? (MOVES[state][event] ?? null) : null;
}
