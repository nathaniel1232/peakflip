-- Coins leaderboard: who has the most coins right now. Read straight from the cloud saves (saves.data->'coins'),
-- so the game doesn't send anything new; only players with a leaderboard name are listed.
-- Paste into Supabase → SQL Editor → Run, after schema.sql. Safe to run again.
-- Coins live in the player's own save, which the browser writes, so this board is easier to fake than the score
-- boards. Anything that isn't a whole number from 0 to 100,000,000 is left off.
begin;

create or replace function public.get_coin_leaderboard(p_pid text, p_limit int default 50)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_result json;
begin
  with coins as (
    select s.pid, (s.data ->> 'coins')::numeric as value
    from saves s
    where jsonb_typeof(s.data -> 'coins') = 'number'
      and (s.data ->> 'coins') ~ '^\d{1,9}$'
      and (s.data ->> 'coins')::numeric <= 100000000
  ), ranked as (
    select c.pid, p.name, c.value, rank() over (order by c.value desc) as rnk
    from coins c join players p using (pid)
    where c.value > 0
  ) select json_build_object(
    'top', coalesce((select json_agg(json_build_object('rank', rnk, 'name', name, 'value', value, 'isMe', pid = p_pid) order by rnk, name, pid)
      from (select * from ranked order by rnk, name, pid limit least(greatest(coalesce(p_limit, 50), 1), 100)) t), '[]'::json),
    'me', (select json_build_object('rank', rnk, 'value', value) from ranked where pid = p_pid),
    'total', (select count(*) from ranked)
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.get_coin_leaderboard(text, int) from public;
grant execute on function public.get_coin_leaderboard(text, int) to anon, authenticated;

commit;
