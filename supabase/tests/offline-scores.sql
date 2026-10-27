-- Run after score-cap.sql with: supabase db query --linked --file supabase/tests/offline-scores.sql
-- All test players and scores are rolled back.
begin;
do $$
declare
  endless_pid text := 'pf_offline_' || replace(gen_random_uuid()::text, '-', '');
  race_pid text := 'pf_offline_' || replace(gen_random_uuid()::text, '-', '');
  current_pid text := 'pf_offline_' || replace(gen_random_uuid()::text, '-', '');
  today date := (now() at time zone 'utc')::date;
  old_day date := (now() at time zone 'utc')::date - 30;
  future_day text := to_char((now() at time zone 'utc')::date + 1, 'YYYY-MM-DD');
  result json;
begin
  -- A queued Endless run retains its earned day, even after the former six-day window.
  result := public.submit_score_v2('endless', to_char(old_day, 'YYYY-MM-DD'), endless_pid, 'Offline endless', 6200);
  assert (result->>'ok')::boolean, 'old Endless run must be accepted';
  assert (select value = 6200 from public.score_days where board = 'endless' and day = old_day and pid = endless_pid),
    'old Endless run must keep its earned day';
  assert (select value = 6200 from public.scores where board = 'endless' and day = '' and pid = endless_pid),
    'old Endless run must update the lifetime record';
  result := public.get_leaderboard_v2('endless', '', endless_pid, 20, 'daily');
  assert result->>'me' is null, 'old Endless run must not enter today''s board';

  perform public.submit_score_v2('endless', to_char(old_day, 'YYYY-MM-DD'), endless_pid, '', 6100);
  assert (select value = 6200 from public.score_days where board = 'endless' and day = old_day and pid = endless_pid),
    'a lower queued Endless run must not lower its daily record';
  assert (select value = 6200 from public.scores where board = 'endless' and day = '' and pid = endless_pid),
    'a lower queued Endless run must not lower its lifetime record';
  perform public.submit_score_v2('endless', '2001-01-01', endless_pid, '', 50);
  assert (select value = 50 from public.score_days where board = 'endless' and day = date '2001-01-01' and pid = endless_pid),
    'a very old valid run must not be silently relabeled as today';
  assert not exists(select 1 from public.score_days where board = 'endless' and day = today and pid = endless_pid),
    'old Endless runs must not create today''s score';

  -- The empty Endless day remains a compatibility spelling for today.
  perform public.submit_score_v2('endless', '', current_pid, 'Current endless', 700);
  assert (select value = 700 from public.score_days where board = 'endless' and day = today and pid = current_pid),
    'empty Endless day must still mean today';

  -- A queued race keeps its original board and best score/time after the former one-day window.
  result := public.submit_score_v2('racepts', to_char(old_day, 'YYYY-MM-DD'), race_pid, 'Offline race', 4200, 70);
  assert (result->>'ok')::boolean, 'old race run must be accepted';
  assert (select value = 4200 and elapsed = 70 from public.score_days where board = 'racepts' and day = old_day and pid = race_pid),
    'old race run must keep its earned day and time';
  result := public.get_leaderboard_v2('racepts', to_char(old_day, 'YYYY-MM-DD'), race_pid);
  assert (result->'me'->>'value')::double precision = 4200, 'old race run must appear on its original board';
  result := public.get_leaderboard_v2('racepts', to_char(today, 'YYYY-MM-DD'), race_pid);
  assert result->>'me' is null, 'old race run must not enter today''s board';
  perform public.submit_score_v2('racepts', to_char(old_day, 'YYYY-MM-DD'), race_pid, '', 4100, 30);
  assert (select value = 4200 and elapsed = 70 from public.score_days where board = 'racepts' and day = old_day and pid = race_pid),
    'a lower race score must not replace its best run';

  begin
    perform public.submit_score_v2('endless', future_day, endless_pid, '', 9000);
    raise exception 'future Endless day accepted';
  exception when raise_exception then
    if sqlerrm <> 'bad day' then raise; end if;
  end;
  begin
    perform public.submit_score_v2('racepts', future_day, race_pid, '', 9000, 70);
    raise exception 'future race day accepted';
  exception when raise_exception then
    if sqlerrm <> 'bad day' then raise; end if;
  end;
  begin
    perform public.submit_score_v2('endless', '2024-02-30', endless_pid, '', 9000);
    raise exception 'malformed Endless day accepted';
  exception when raise_exception then
    if sqlerrm <> 'bad day' then raise; end if;
  end;
  begin
    perform public.submit_score_v2('racepts', '', race_pid, '', 9000, 70);
    raise exception 'empty race day accepted';
  exception when raise_exception then
    if sqlerrm <> 'bad day' then raise; end if;
  end;
end $$;
rollback;
select 'Offline score checks passed; test writes rolled back.' as result;
