-- Run with: supabase db query --linked --file supabase/tests/admin.sql
-- Every test write is rolled back, so test players, admins and messages never reach the live game.
begin;
do $$
declare
  a text := 'pf_qa_' || replace(gen_random_uuid()::text, '-', '');
  b text := 'pf_qa_' || replace(gen_random_uuid()::text, '-', '');
  token text := repeat('a', 64);
  name_a text := 'QA' || right(a, 10);
  result json;
  v_last bigint;
begin
  perform register_name(a, name_a);
  perform register_name(b, 'QA' || right(b, 10));
  result := get_game_events(b, 0);
  assert not (result->>'admin')::bool and not (result->>'fly')::bool, 'new players are not admins';
  v_last := (result->>'last')::bigint;

  perform pf_announce('QA hello everyone');
  result := get_game_events(b, v_last);
  assert json_array_length(result->'events') = 1 and result->'events'->0->>'body' = 'QA hello everyone', 'announcement reaches players';
  result := get_game_events(b, (result->>'last')::bigint);
  assert json_array_length(result->'events') = 0, 'an announcement is shown once';

  perform pf_make_admin(name_a);
  result := get_game_events(a, 0);
  assert (result->>'admin')::bool and (result->>'fly')::bool, 'admin can fly';
  perform pf_make_admin(name_a, false);
  result := get_game_events(a, 0);
  assert (result->>'admin')::bool and not (result->>'fly')::bool, 'flying can be taken away';

  result := admin_command(a, token, 'say', 'hi'); assert result->>'error' = 'identity', 'admin commands need the chat token';
  perform open_chat_session(a, token);
  perform open_chat_session(b, token);
  result := admin_command(b, token, 'say', 'hi'); assert result->>'error' = 'not_admin', 'players cannot use admin commands';
  result := admin_command(a, token, 'say', 'QA from an admin'); assert (result->>'ok')::bool, 'admins can announce';
  result := admin_command(a, token, 'say', 'again'); assert result->>'error' = 'too_fast', 'admin commands are throttled';
  perform pf_remove_admin(name_a);
  result := get_game_events(a, 0); assert not (result->>'admin')::bool, 'admin can be removed';

  assert not has_table_privilege('anon', 'public.admins', 'SELECT'), 'admin list is private';
  assert not has_table_privilege('anon', 'public.game_events', 'INSERT'), 'players cannot write events';
  assert not has_function_privilege('anon', 'public.pf_announce(text, int)', 'EXECUTE'), 'owner tools are SQL Editor only';
  assert not has_function_privilege('anon', 'public.pf_make_admin(text, boolean)', 'EXECUTE'), 'owner tools are SQL Editor only';
  assert not has_function_privilege('anon', 'public.pf_send_to_offpiste(text)', 'EXECUTE'), 'owner tools are SQL Editor only';
end $$;
rollback;
select 'All announcement, admin, flying, command and access checks passed; test writes rolled back.' as result;
