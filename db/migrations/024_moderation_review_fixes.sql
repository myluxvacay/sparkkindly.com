-- Comment moderation review fixes (7B review M1, M2). Expand only: two nullable columns the previous release ignores.
-- moderation_code: the closed author-facing reason code of a reject or hide (the author's email shows only the fixed
-- sentence for it; the agent's free-text moderation_reason stays with the owner). escalation_note: the agent's note to
-- the owner when it escalates; never emailed or shown to the author.
-- Rollback: ALTER TABLE comments DROP COLUMN escalation_note, DROP COLUMN moderation_code;
-- DELETE FROM schema_migrations WHERE name = '024_moderation_review_fixes.sql'.
ALTER TABLE comments ADD COLUMN moderation_code text
  CHECK (moderation_code IN ('abuse', 'personal_info', 'advertising', 'off_topic', 'links', 'other'));
ALTER TABLE comments ADD COLUMN escalation_note text CHECK (char_length(escalation_note) BETWEEN 1 AND 300);
