-- The Surf leaderboard: its own board, 'surf', with All time and Daily (and Weekly for CrazyGames) like Endless.
-- Every surf run is kept per day in score_days; All time is each player's best day. Safe to run again.
-- Run it after points-and-chat.sql, names.sql and score-cap.sql.
begin;
alter table public.score_days drop constraint if exists score_days_board_check;
alter table public.score_days add constraint score_days_board_check check (board in ('endless', 'racepts', 'surf'));

create or replace function public.submit_score_v2(
  p_board text, p_day text, p_pid text, p_name text, p_value double precision,
  p_time double precision default null, p_ghost jsonb default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_day date;
  v_name text;
begin
  if p_board is null or p_board not in ('endless', 'racepts', 'surf') then raise exception 'bad board'; end if;
  if p_pid is null or p_pid !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad pid'; end if;
  if p_value is null or p_value < 0 or p_value > 100000000 then raise exception 'bad value'; end if;
  if p_board in ('endless', 'surf') and coalesce(p_day, '') = '' then
    v_day := v_today;
  else
    if p_day is null or p_day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'bad day'; end if;
    begin
      v_day := p_day::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'bad day';
    end;
    if to_char(v_day, 'YYYY-MM-DD') <> p_day or v_day > v_today then raise exception 'bad day'; end if;
  end if;
  v_name := (select name from players where pid = p_pid);
  if v_name is null then
    v_name := clean_name(p_name);
    if length(v_name) < 1 then raise exception 'register a name first'; end if;
    insert into players (pid, name) values (p_pid, v_name) on conflict (pid) do nothing;
    v_name := (select name from players where pid = p_pid);
  end if;
  if p_board = 'endless' then
    p_time := null; p_ghost := null;
    insert into scores as s (board, day, pid, name, value)
    values ('endless', '', p_pid, v_name, p_value)
    on conflict (board, day, pid) do update set
      name = excluded.name, value = greatest(s.value, excluded.value), updated_at = now();
  elsif p_board = 'surf' then
    p_time := null; p_ghost := null;
  else
    if p_time is null or p_time < 25 or p_time > 900 then raise exception 'bad time'; end if;
    if p_ghost is not null then
      if jsonb_typeof(p_ghost -> 'f') is distinct from 'array' then
        p_ghost := null;
      elsif jsonb_array_length(p_ghost -> 'f') not between 60 and 54000
          or jsonb_array_length(p_ghost -> 'f') % 6 <> 0 or pg_column_size(p_ghost) > 600000 then
        p_ghost := null;
      elsif exists(select 1 from jsonb_array_elements(p_ghost -> 'f') e(value)
          where case when jsonb_typeof(e.value) = 'number' then abs((e.value #>> '{}')::numeric) > 100000000 else true end) then
        p_ghost := null;
      else
        p_ghost := jsonb_build_object('t', p_time, 'score', p_value, 'f', p_ghost -> 'f');
      end if;
    end if;
  end if;
  insert into score_days as s (board, day, pid, value, elapsed, ghost)
  values (p_board, v_day, p_pid, p_value, p_time, p_ghost)
  on conflict (board, day, pid) do update set value = excluded.value, elapsed = excluded.elapsed, ghost = excluded.ghost
  where excluded.value > s.value or (excluded.value = s.value and excluded.elapsed < s.elapsed);
  return json_build_object('ok', true);
end $$;

create or replace function public.get_leaderboard_v2(
  p_board text, p_day text, p_pid text, p_limit int default 20, p_period text default 'all'
) returns json language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'utc')::date; v_result json;
begin
  if p_board is null or p_board not in ('endless', 'racepts', 'surf') then raise exception 'bad board'; end if;
  if p_period is null or p_period not in ('all', 'weekly', 'daily') then raise exception 'bad period'; end if;
  with candidates as (
    select s.pid, s.value, null::double precision as elapsed
    from scores s where p_board = 'endless' and p_period = 'all' and s.board = 'endless' and s.day = ''
    union all
    select s.pid, s.value, s.elapsed from score_days s where s.board = p_board
    and case when p_board = 'racepts' then s.day::text = p_day
      when p_period = 'daily' then s.day = v_today
      when p_period = 'weekly' then s.day >= date_trunc('week', v_today::timestamp)::date and s.day <= v_today
      else true end
  ), best as (
    select distinct on (pid) pid, value, elapsed from candidates order by pid, value desc, elapsed asc nulls last
  ), ranked as (
    select b.pid, p.name, b.value, b.elapsed,
      rank() over (order by b.value desc, b.elapsed asc nulls last) as rnk
    from best b join players p using (pid)
  ) select json_build_object(
    'top', coalesce((select json_agg(json_build_object('rank', rnk, 'name', name, 'value', value, 'time', elapsed, 'isMe', pid = p_pid) order by rnk, name, pid)
      from (select * from ranked order by rnk, name, pid limit least(greatest(coalesce(p_limit, 20), 1), 100)) t), '[]'::json),
    'me', (select json_build_object('rank', rnk, 'value', value, 'time', elapsed) from ranked where pid = p_pid),
    'total', (select count(*) from ranked)
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.submit_score_v2(text,text,text,text,double precision,double precision,jsonb) from public;
grant execute on function public.submit_score_v2(text,text,text,text,double precision,double precision,jsonb) to anon, authenticated;
revoke all on function public.get_leaderboard_v2(text,text,text,int,text) from public;
grant execute on function public.get_leaderboard_v2(text,text,text,int,text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
