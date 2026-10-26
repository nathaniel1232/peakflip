-- Run with: supabase db query --linked --file supabase/tests/score-cap.sql
-- Test rows are never committed or visible to other players.
begin;
do $$
declare
  test_pid text := 'pf_score_qa_' || replace(gen_random_uuid()::text, '-', '');
  result json;
begin
  result := public.submit_score_v2('endless', to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD'), test_pid, 'Score cap test', 3000000);
  assert (result->>'ok')::boolean, 'exactly three million must be accepted';
  result := public.submit_score_v2('endless', to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD'), test_pid, 'Score cap test', 3000001);
  assert (result->>'ok')::boolean, 'above three million must be accepted';
  assert (select value from public.scores where board='endless' and day='' and pid=test_pid)=3000001, 'lifetime score must update';
  assert (select value from public.score_days where board='endless' and day=(now() at time zone 'utc')::date and pid=test_pid)=3000001, 'daily score must update atomically';
  result := public.get_leaderboard_v2('endless','',test_pid,100,'all');
  assert (result->'me'->>'value')::numeric=3000001, 'the saved score must be visible on the leaderboard';
  perform public.submit_score_v2('endless','',test_pid,'Score cap test',100000000);
  begin
    perform public.submit_score_v2('endless','',test_pid,'Score cap test',100000001);
    raise exception 'score above the supported cap was accepted';
  exception when raise_exception then
    if sqlerrm <> 'bad value' then raise; end if;
  end;
  assert (select value from public.scores where board='endless' and day='' and pid=test_pid)=100000000, 'rejected scores must not change the record';
end $$;
rollback;
