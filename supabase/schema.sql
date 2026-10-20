-- Peak Flip leaderboards + race ghosts.
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to run again.

create table if not exists public.scores (
  board      text not null check (board in ('endless', 'race')),
  day        text not null default '',          -- '' for endless, 'YYYY-MM-DD' (UTC) for the daily race
  pid        text not null,                      -- random player id stored in the browser
  name       text not null,
  value      double precision not null,          -- endless: score (higher is better) · race: seconds (lower is better)
  ghost      jsonb,                              -- race only: { t, f: [x,y,z,rx,ry,rz, ...] }
  updated_at timestamptz not null default now(),
  primary key (board, day, pid)
);
create index if not exists scores_rank_idx on public.scores (board, day, value);

-- The browser never touches the table directly; it only calls the functions below.
alter table public.scores enable row level security;
revoke all on public.scores from anon, authenticated;

create or replace function public.submit_score(
  p_board text, p_day text, p_pid text, p_name text, p_value double precision, p_ghost jsonb default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_name  text;
  v_today date := (now() at time zone 'utc')::date;
begin
  if p_board not in ('endless', 'race') then raise exception 'bad board'; end if;
  if p_pid is null or p_pid !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad pid'; end if;
  v_name := btrim(left(regexp_replace(coalesce(p_name, ''), '[^[:alnum:] _.!-]', '', 'g'), 14));
  if v_name = '' then raise exception 'bad name'; end if;

  if p_board = 'endless' then
    if p_value is null or p_value < 0 or p_value > 3000000 then raise exception 'bad value'; end if;
    p_day := ''; p_ghost := null;
  else
    if p_value is null or p_value < 25 or p_value > 900 then raise exception 'bad value'; end if;
    if p_day not in (to_char(v_today - 1, 'YYYY-MM-DD'), to_char(v_today, 'YYYY-MM-DD'), to_char(v_today + 1, 'YYYY-MM-DD')) then
      raise exception 'bad day';
    end if;
    if p_ghost is not null and (jsonb_typeof(p_ghost -> 'f') is distinct from 'array'
        or jsonb_array_length(p_ghost -> 'f') > 54000 or pg_column_size(p_ghost) > 600000) then
      p_ghost := null;
    end if;
  end if;

  insert into scores as s (board, day, pid, name, value, ghost, updated_at)
  values (p_board, p_day, p_pid, v_name, p_value, p_ghost, now())
  on conflict (board, day, pid) do update set
    name  = excluded.name,
    -- keep the ghost that belongs to the best time
    ghost = case when excluded.ghost is not null and (excluded.value < s.value or s.ghost is null) then excluded.ghost else s.ghost end,
    value = case when p_board = 'race' then least(s.value, excluded.value) else greatest(s.value, excluded.value) end,
    updated_at = now();

  return json_build_object('ok', true);
end $$;

create or replace function public.get_leaderboard(p_board text, p_day text, p_pid text, p_limit int default 20)
returns json
language sql stable security definer set search_path = public as $$
  with ranked as (
    select pid, name, value,
           rank() over (order by case when p_board = 'race' then value else -value end) as rnk
    from scores
    where board = p_board and day = case when p_board = 'endless' then '' else coalesce(p_day, '') end
  )
  select json_build_object(
    'top',   coalesce((select json_agg(json_build_object('name', name, 'value', value, 'isMe', pid = p_pid) order by rnk)
                       from (select * from ranked order by rnk limit least(greatest(p_limit, 1), 100)) t), '[]'::json),
    'me',    (select json_build_object('rank', rnk, 'value', value) from ranked where pid = p_pid),
    'total', (select count(*) from ranked)
  );
$$;

create or replace function public.get_ghosts(p_day text, p_pid text)
returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('name', name, 'ghost', ghost)), '[]'::json)
  from (
    select name, ghost from scores
    where board = 'race' and day = p_day and pid <> p_pid and ghost is not null
    order by value limit 3
  ) t;
$$;

revoke all on function public.submit_score(text, text, text, text, double precision, jsonb) from public;
revoke all on function public.get_leaderboard(text, text, text, int) from public;
revoke all on function public.get_ghosts(text, text) from public;
grant execute on function public.submit_score(text, text, text, text, double precision, jsonb) to anon, authenticated;
grant execute on function public.get_leaderboard(text, text, text, int) to anon, authenticated;
grant execute on function public.get_ghosts(text, text) to anon, authenticated;
