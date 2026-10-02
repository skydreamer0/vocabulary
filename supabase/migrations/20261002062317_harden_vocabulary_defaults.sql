-- Defensive defaults for this dedicated application's future functions.
begin;
-- Global default PUBLIC EXECUTE must be revoked globally; schema revokes alone cannot undo it.
alter default privileges revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
alter default privileges in schema vocab_private revoke execute on functions from public,anon,authenticated;
alter table vocab_private.rate_limits enable row level security;
-- App roles must only enter the private schema through the exact granted RPC implementations.
revoke all on vocab_private.rate_limits from public,anon,authenticated;
commit;
