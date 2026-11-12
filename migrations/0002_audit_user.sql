-- The workspace reads one person's status history: index it by user.
CREATE INDEX audit_user_id ON audit (user_id, id);
