-- Names and automatic score submission. Run after schema.sql and points-and-chat.sql. Safe to run again.
-- It creates no tables, so if the SQL editor offers to "enable RLS", choose "Run without RLS" (every table already has RLS).
--  · Any name works: names no longer have to be unique, and anything printable (accents, emoji, punctuation)
--    up to 20 characters is kept. Several players can share a name; rows are still one per player id.
--  · Players can change their name whenever they like (no cooldown); old scores follow the new name.
--  · submit_score_v2 registers the player on the spot if the database doesn't know them yet (a save that
--    came from another domain, an older version, …), so a score with a name is never turned away.
--  · Endless scores can be sent up to six days late (from the queue of runs played offline or before
--    picking a name) and still count for the day they were earned.
begin;
drop index if exists public.players_name_unique;
create index if not exists players_name_idx on public.players (lower(name));

create or replace function public.clean_name(p_name text) returns text
language sql immutable set search_path = public as $$
  select btrim(left(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g'), 20));
$$;

create or replace function public.register_name(p_pid text, p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare v_name text; v_existing text;
begin
  if p_pid is null or p_pid !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad pid'; end if;
  v_existing := (select name from players where pid = p_pid);
  if v_existing is not null then return json_build_object('ok', true, 'name', v_existing, 'locked', true); end if;
  v_name := clean_name(p_name);
  if length(v_name) < 1 then return json_build_object('ok', false, 'error', 'too_short'); end if;
  insert into players (pid, name) values (p_pid, v_name) on conflict (pid) do nothing;
  return json_build_object('ok', true, 'name', (select name from players where pid = p_pid));
end $$;

create or replace function public.change_name(p_pid text, p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if p_pid is null or p_pid !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad pid'; end if;
  v_name := clean_name(p_name);
  if length(v_name) < 1 then return json_build_object('ok', false, 'error', 'too_short'); end if;
  insert into players (pid, name) values (p_pid, v_name)
  on conflict (pid) do update set name = excluded.name, renamed_at = now() where players.name is distinct from excluded.name;
  update scores set name = v_name where pid = p_pid and name is distinct from v_name;
  return json_build_object('ok', true, 'name', v_name);
end $$;

create or replace function public.submit_score_v2(
  p_board text, p_day text, p_pid text, p_name text, p_value double precision,
  p_time double precision default null, p_ghost jsonb default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_day date;
  v_name text;
begin
  if p_board is null or p_board not in ('endless', 'racepts') then raise exception 'bad board'; end if;
  if p_pid is null or p_pid !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad pid'; end if;
  if p_value is null or p_value < 0 or p_value > 3000000 then raise exception 'bad value'; end if;
  v_name := (select name from players where pid = p_pid);
  if v_name is null then
    v_name := clean_name(p_name);
    if length(v_name) < 1 then raise exception 'register a name first'; end if;
    insert into players (pid, name) values (p_pid, v_name) on conflict (pid) do nothing;
    v_name := (select name from players where pid = p_pid);
  end if;
  if p_board = 'endless' then
    v_day := v_today;
    if p_day ~ '^\d{4}-\d{2}-\d{2}$' and p_day::date between v_today - 6 and v_today then v_day := p_day::date; end if;
    p_time := null; p_ghost := null;
    insert into scores as s (board, day, pid, name, value)
    values ('endless', '', p_pid, v_name, p_value)
    on conflict (board, day, pid) do update set
      name = excluded.name, value = greatest(s.value, excluded.value), updated_at = now();
  else
    if p_day is null or p_day not in (to_char(v_today, 'YYYY-MM-DD'), to_char(v_today - 1, 'YYYY-MM-DD')) then raise exception 'bad day'; end if;
    v_day := p_day::date;
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
        -- Metadata comes from the validated result, never arbitrary ghost metadata.
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

revoke all on function public.clean_name(text) from public;
revoke all on function public.register_name(text, text) from public;
revoke all on function public.change_name(text, text) from public;
revoke all on function public.submit_score_v2(text,text,text,text,double precision,double precision,jsonb) from public;
grant execute on function public.register_name(text, text) to anon, authenticated;
grant execute on function public.change_name(text, text) to anon, authenticated;
grant execute on function public.submit_score_v2(text,text,text,text,double precision,double precision,jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
