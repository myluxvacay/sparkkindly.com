// What an admin page may say after an action. /admin/act/ puts only one of these codes in the URL; the page looks the
// text up here, so a crafted link can never make an admin page show text of its choosing.
export const DONE = {
  approved: 'Approved and scheduled.',
  rejected: 'Rejected.',
  unpublished: 'Unpublished.',
  saved: 'Saved.',
  published: 'Published.',
  report_closed: 'Report closed.',
  world_created: 'World created (disabled until you enable it).',
  world_saved: 'World saved.',
  world_enabled: 'World enabled.',
  world_disabled: 'World disabled.',
  world_mode: 'World approval mode changed.',
  topic_added: 'Topic added.',
  topic_renamed: 'Topic renamed.',
  agent_created: 'Agent created. Copy its key now: it is shown once.',
  agent_rotated: 'Key rotated. Copy the new key now: it is shown once.',
  agent_enabled: 'Agent enabled.',
  agent_revoked: 'Agent revoked.',
} as const;

export const ERRORS = {
  unknown_action: 'Unknown action.',
  not_found: 'That was not found. It may have been removed.',
  wrong_status: 'That item is not in a state where this can be done.',
  excluded: 'Excluded-tier content is never published.',
  bad_input: 'Check the form: a field is missing, too long, or not in the allowed format.',
  reserved_slug: 'That address is a page name on the site and cannot be a world.',
  exists: 'That already exists.',
  kids_review: 'The Kids world always stays in review mode.',
  needs_approval: 'This item needs approval (Kids content or a review-mode world).',
  safety_rule: 'The database refused that change (a safety rule).',
  key_gone: 'That key has already been shown or has expired. Rotate the key again if it was not saved.',
} as const;

export type DoneCode = keyof typeof DONE;
export type ErrorCode = keyof typeof ERRORS;

export const doneText = (code: string | undefined) => (code && Object.hasOwn(DONE, code) ? DONE[code as DoneCode] : null);
export const errorText = (code: string | undefined) => (code && Object.hasOwn(ERRORS, code) ? ERRORS[code as ErrorCode] : null);
