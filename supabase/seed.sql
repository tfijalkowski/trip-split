-- seed.sql — local dev only; applied by `supabase db reset`
-- Test user UUIDs:
--   Alice: 00000000-0000-0000-0000-000000000001
--   Bob:   00000000-0000-0000-0000-000000000002
-- Test group UUID:
--   Trip:  00000000-0000-0000-0000-000000000010

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, role, aud
)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'alice@example.com', '', now(),
   '{"full_name": "Alice Test"}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000002', 'bob@example.com', '', now(),
   '{"full_name": "Bob Test"}'::jsonb, now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- profiles rows (trigger also creates them on auth.users INSERT; ON CONFLICT ensures idempotency)
INSERT INTO public.profiles (id, email, display_name)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'alice@example.com', 'Alice Test'),
  ('00000000-0000-0000-0000-000000000002', 'bob@example.com',   'Bob Test')
ON CONFLICT (id) DO NOTHING;

-- group (Alice is creator)
INSERT INTO public.groups (id, name, invite_code, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  'Test Trip',
  'TESTCODE',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- memberships
INSERT INTO public.group_members (group_id, user_id)
VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (group_id, user_id) DO NOTHING;
