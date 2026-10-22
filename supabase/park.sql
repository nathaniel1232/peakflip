-- Terrain park: every player's best park run (score, time and ghost) is kept for good, and the best few
-- are handed out as ghosts to ride alongside. Additive: touches nothing the other boards use.
begin;
create table if not exists public.park_runs (
  pid text primary key references public.players(pid),
  value double precision not null check (value >= 0 and value <= 3000000),
  elapsed double precision not null,
  ghost jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists park_runs_rank on public.park_runs(value desc, elapsed);
alter table public.park_runs enable row level security;
revoke all on public.park_runs from public, anon, authenticated;

create or replace function public.submit_park_run(
  p_pid text, p_name text, p_value double precision, p_time double precision, p_ghost jsonb default null
) returns json language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if p_pid is null or p_pid !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad pid'; end if;
  if p_value is null or p_value < 0 or p_value > 3000000 then raise exception 'bad value'; end if;
  if p_time is null or p_time < 20 or p_time > 600 then raise exception 'bad time'; end if;
  v_name := (select name from players where pid = p_pid);
  if v_name is null then
    v_name := clean_name(p_name);
    if length(v_name) < 1 then raise exception 'register a name first'; end if;
    insert into players (pid, name) values (p_pid, v_name) on conflict (pid) do nothing;
  end if;
  if p_ghost is not null then
    if jsonb_typeof(p_ghost -> 'f') is distinct from 'array' then
      p_ghost := null;
    elsif jsonb_array_length(p_ghost -> 'f') not between 60 and 36000
        or jsonb_array_length(p_ghost -> 'f') % 6 <> 0 or pg_column_size(p_ghost) > 400000 then
      p_ghost := null;
    elsif exists(select 1 from jsonb_array_elements(p_ghost -> 'f') e(value)
        where case when jsonb_typeof(e.value) = 'number' then abs((e.value #>> '{}')::numeric) > 100000000 else true end) then
      p_ghost := null;
    else
      p_ghost := jsonb_build_object('t', p_time, 'score', p_value, 'f', p_ghost -> 'f');
    end if;
  end if;
  insert into park_runs as s (pid, value, elapsed, ghost)
  values (p_pid, p_value, p_time, p_ghost)
  on conflict (pid) do update set value = excluded.value, elapsed = excluded.elapsed, ghost = excluded.ghost, updated_at = now()
  where excluded.value > s.value or (excluded.value = s.value and excluded.elapsed < s.elapsed);
  return json_build_object('ok', true);
end $$;

create or replace function public.get_park_ghosts(p_pid text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('name', name, 'ghost', ghost) order by value desc, elapsed), '[]'::json)
  from (select p.name, s.ghost, s.value, s.elapsed from park_runs s join players p using (pid)
    where s.pid <> p_pid and s.ghost is not null
    order by s.value desc, s.elapsed, s.pid limit 3) t;
$$;

revoke all on function public.submit_park_run(text,text,double precision,double precision,jsonb) from public;
revoke all on function public.get_park_ghosts(text) from public;
grant execute on function public.submit_park_run(text,text,double precision,double precision,jsonb) to anon, authenticated;
grant execute on function public.get_park_ghosts(text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
