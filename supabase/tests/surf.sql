-- Run with: supabase db query --linked --file supabase/tests/surf.sql
-- Test rows are never committed or visible to other players.
begin;
do $$
declare
  test_pid text := 'pf_surf_qa_' || replace(gen_random_uuid()::text, '-', '');
  today text := to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD');
  result json;
begin
  result := public.submit_score_v2('surf', today, test_pid, 'Surf test', 4200);
  assert (result->>'ok')::boolean, 'a surf run must be accepted';
  result := public.submit_score_v2('surf', today, test_pid, 'Surf test', 3100);
  assert (select value from public.score_days where board='surf' and day=(now() at time zone 'utc')::date and pid=test_pid)=4200, 'a lower run must not replace the best';
  result := public.get_leaderboard_v2('surf', '', test_pid, 100, 'all');
  assert (result->'me'->>'value')::numeric=4200, 'the surf best must be on the all-time surf board';
  result := public.get_leaderboard_v2('surf', '', test_pid, 100, 'daily');
  assert (result->'me'->>'value')::numeric=4200, 'the surf best must be on the daily surf board';
  assert not exists(select 1 from public.scores where pid=test_pid), 'a surf run must not touch the ski Endless record';
end $$;
rollback;
