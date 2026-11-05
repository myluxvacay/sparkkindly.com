-- Contribution reviewer role (Project 8 review H1): the contribution review run gets its own key, role 'reviewer',
-- accepted only by /api/agent/contributions/* and refused (403) everywhere else, so injected contribution text can never
-- steer a run that also holds the item submit tool. Expand only: the role CHECK widens to allow the new value; the
-- previous release refuses a reviewer key on every route (its routes accept only 'content' or 'moderation').
-- Rollback (before deploying the previous release): UPDATE agents SET enabled = false WHERE role = 'reviewer';
-- then, only to restore the narrower CHECK: DELETE FROM agents WHERE role = 'reviewer';
-- ALTER TABLE agents DROP CONSTRAINT agents_role_check,
--   ADD CONSTRAINT agents_role_check CHECK (role IN ('content', 'moderation'));
-- DELETE FROM schema_migrations WHERE name = '026_reviewer_role.sql'.
ALTER TABLE agents DROP CONSTRAINT agents_role_check,
  ADD CONSTRAINT agents_role_check CHECK (role IN ('content', 'moderation', 'reviewer'));
