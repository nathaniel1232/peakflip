-- Run with: supabase db query --linked --file supabase/tests/points-and-chat.sql
-- Every test write is rolled back, so test players/messages never reach the live game.
begin;
do $$
declare
  a text := 'pf_qa_' || replace(gen_random_uuid()::text, '-', '');
  b text := 'pf_qa_' || replace(gen_random_uuid()::text, '-', '');
  token text := repeat('a', 64);
  today text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  result json;
  rank_a int;
  rank_b int;
  v_message_id bigint;
begin
  perform register_name(a, 'QA' || right(a, 10));
  perform register_name(b, 'QA' || right(b, 10));
  perform submit_score_v2('endless', '', a, 'ignored name', 1200);
  perform submit_score_v2('endless', '', a, '', 400);
  result := get_leaderboard_v2('endless', '', a, 20, 'daily');
  assert (result->'me'->>'value')::float = 1200, 'daily best must not fall after a lower score';
  -- A huge old personal best must never leak into a newly earned daily/weekly score.
  update scores set value = 9000 where board = 'endless' and pid = a;
  perform submit_score_v2('endless', '', a, '', 1500);
  result := get_leaderboard_v2('endless', '', a, 20, 'daily');
  assert (result->'me'->>'value')::float = 1500, 'daily score must use actual run';
  result := get_leaderboard_v2('endless', '', a, 20, 'all');
  assert (result->'me'->>'value')::float = 9000, 'legacy lifetime best must remain';
  insert into score_days(board, day, pid, value) values ('endless', (now() at time zone 'utc')::date - 8, a, 8000);
  result := get_leaderboard_v2('endless', '', a, 20, 'weekly');
  assert (result->'me'->>'value')::float = 1500, 'old days must not count in current UTC week';

  perform submit_score_v2('racepts', today, a, '', 2000, 80, jsonb_build_object('f', to_jsonb(array_fill(0, array[60]))));
  perform submit_score_v2('racepts', today, b, '', 1800, 40);
  result := get_leaderboard_v2('racepts', today, a); rank_a := (result->'me'->>'rank')::int;
  result := get_leaderboard_v2('racepts', today, b); rank_b := (result->'me'->>'rank')::int;
  assert rank_a < rank_b, 'more points must beat faster time';
  perform submit_score_v2('racepts', today, b, '', 2000, 60);
  result := get_leaderboard_v2('racepts', today, b); rank_b := (result->'me'->>'rank')::int;
  result := get_leaderboard_v2('racepts', today, a); rank_a := (result->'me'->>'rank')::int;
  assert rank_b < rank_a, 'faster time must break equal points';
  perform submit_score_v2('racepts', today, a, '', 2000, 60, jsonb_build_object('f', to_jsonb(array_fill(1, array[60]))));
  result := get_leaderboard_v2('racepts', today, a); rank_a := (result->'me'->>'rank')::int;
  assert rank_a = rank_b, 'identical points and time must share rank';
  perform submit_score_v2('racepts', today, a, '', 1000, 30);
  assert (select value = 2000 and elapsed = 60 and (ghost->>'score')::float = 2000 and (ghost->>'t')::float = 60
    from score_days where board = 'racepts' and pid = a), 'inferior run must not change best or ghost';
  begin
    perform submit_score_v2('racepts', today, a, '', 1000, 'NaN'::float);
    raise exception 'invalid race time accepted';
  exception when raise_exception then assert sqlerrm = 'bad time'; end;
  begin
    perform get_leaderboard_v2('endless', '', a, 20, 'invalid');
    raise exception 'invalid period accepted';
  exception when raise_exception then assert sqlerrm = 'bad period'; end;

  result := open_chat_session(a, token); assert (result->>'ok')::bool, 'chat identity should register';
  result := open_chat_session(a, repeat('b',64)); assert not (result->>'ok')::bool, 'chat token cannot be replaced';
  result := send_chat_message(a, repeat('b',64), 'wrong token'); assert result->>'error' = 'identity';
  result := send_chat_message(a, token, '<script>literal text only</script>');
  assert (result->>'ok')::bool, 'valid message should send'; v_message_id := (result->>'id')::bigint;
  result := send_chat_message(a, token, 'too soon'); assert result->>'error' = 'too_fast', 'database must throttle sends';
  update chat_sessions set last_sent_at = now() - interval '6 seconds' where pid = a;
  result := send_chat_message(a, token, repeat('x',241)); assert result->>'error' = 'length';
  result := send_chat_message(a, token, E'\n\t'); assert result->>'error' = 'length';
  result := open_chat_session(b, token); assert (result->>'ok')::bool;
  result := report_chat_message(b, token, v_message_id); assert (result->>'ok')::bool;
  result := report_chat_message(b, token, v_message_id); assert (result->>'ok')::bool;
  assert (select count(*) = 1 from chat_reports where message_id = v_message_id and reporter_pid = b), 'reports must deduplicate';
  update chat_messages set hidden = true where id = v_message_id;
  result := get_chat_messages(a);
  assert not exists(select 1 from json_array_elements(result) m where (m->>'id')::bigint = v_message_id), 'hidden messages must not be read';
  update chat_sessions set muted = true where pid = a;
  result := send_chat_message(a, token, 'muted'); assert result->>'error' = 'muted';
  assert not has_table_privilege('anon', 'public.chat_messages', 'SELECT'), 'chat table must be private';
  assert not has_table_privilege('anon', 'public.chat_sessions', 'SELECT'), 'tokens must be private';
  assert not has_table_privilege('anon', 'public.score_days', 'INSERT'), 'scores need validated functions';
end $$;
rollback;
select 'All score, period, ghost, chat identity, throttle, and access checks passed; test writes rolled back.' as result;
