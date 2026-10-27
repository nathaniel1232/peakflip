-- Run with: supabase db query --linked --file supabase/tests/names.sql
-- Every test write is rolled back, so test players never reach the live game.
begin;
do $$
declare
  a text := 'pf_qa_' || replace(gen_random_uuid()::text, '-', '');
  b text := 'pf_qa_' || replace(gen_random_uuid()::text, '-', '');
  c text := 'pf_qa_' || replace(gen_random_uuid()::text, '-', '');
  result json;
begin
  -- two players may share a name, and any printable name is kept
  assert (register_name(a, 'Fiskå 🎿 #1')->>'ok')::boolean, 'unicode name must register';
  assert (register_name(a, 'other')->>'name') = 'Fiskå 🎿 #1', 'register keeps the existing name';
  assert (change_name(b, 'Fiskå 🎿 #1')->>'ok')::boolean, 'shared names must be allowed';
  assert (change_name(b, '   ')->>'ok')::boolean is false, 'blank names are refused';
  -- renames have no cooldown and carry the scores along
  perform submit_score_v2('endless', '', b, '', 700);
  assert (change_name(b, 'Second')->>'name') = 'Second', 'first rename';
  assert (change_name(b, 'Third')->>'name') = 'Third', 'immediate second rename';
  assert (select name from scores where board = 'endless' and day = '' and pid = b) = 'Third', 'old scores follow the new name';
  -- a player the database has never seen is registered by their first score
  assert (submit_score_v2('endless', '', c, 'Newcomer', 900)->>'ok')::boolean, 'unknown player with a name';
  assert (select name from players where pid = c) = 'Newcomer', 'submit registers the player';
  result := get_leaderboard_v2('endless', '', c, 20, 'daily');
  assert (result->'me'->>'value')::float = 900, 'self-registered score is ranked';
  -- a queued Endless score counts on the day it was earned
  perform submit_score_v2('endless', to_char((now() at time zone 'utc')::date - 3, 'YYYY-MM-DD'), a, '', 1234);
  assert exists(select 1 from score_days where pid = a and day = (now() at time zone 'utc')::date - 3 and value = 1234), 'late endless score keeps its day';
  perform submit_score_v2('endless', '2001-01-01', a, '', 50);
  assert exists(select 1 from score_days where pid = a and day = date '2001-01-01' and value = 50), 'queued run keeps its original day';
end $$;
rollback;
