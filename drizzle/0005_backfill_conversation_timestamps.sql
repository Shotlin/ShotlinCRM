WITH facts AS (
  SELECT
    c.id,
    (
      SELECT max(m.sent_at)
      FROM messages m
      WHERE m.workspace_id = c.workspace_id
        AND m.lead_id = c.lead_id
        AND m.direction = 'inbound'
    ) AS last_in,
    (
      SELECT max(m.sent_at)
      FROM messages m
      WHERE m.workspace_id = c.workspace_id
        AND m.lead_id = c.lead_id
        AND m.direction = 'outbound'
        AND m.state IN ('sent', 'delivered', 'read', 'sample')
    ) AS last_out
  FROM conversations c
)
UPDATE conversations c
SET
  last_inbound_at = f.last_in,
  last_outbound_at = f.last_out,
  last_read_at = COALESCE(c.last_read_at, f.last_out, c.created_at),
  unread_count = (
    SELECT count(*)::int
    FROM messages m
    WHERE m.workspace_id = c.workspace_id
      AND m.lead_id = c.lead_id
      AND m.direction = 'inbound'
      AND m.sent_at > COALESCE(c.last_read_at, f.last_out, c.created_at)
  )
FROM facts f
WHERE c.id = f.id;
