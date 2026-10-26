-- Additive migration: keeps legacy time races and lifetime Endless scores intact.
-- Week boundaries are Monday 00:00 UTC; day boundaries are 00:00 UTC.
begin;
create table if not exists public.score_days (
  board text not null check (board in ('endless', 'racepts')),
  day date not null,
  pid text not null references public.players(pid),
  value double precision not null check (value >= 0 and value <= 100000000),
  elapsed double precision,
  ghost jsonb,
  primary key (board, day, pid)
);
-- CREATE TABLE IF NOT EXISTS leaves old constraints unchanged. Upgrade existing installations too.
alter table public.score_days drop constraint if exists score_days_value_check;
alter table public.score_days add constraint score_days_value_check check (value >= 0 and value <= 100000000);
create index if not exists score_days_rank on public.score_days(board, day, value desc, elapsed);
alter table public.score_days enable row level security;
revoke all on public.score_days from public, anon, authenticated;

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
  if p_value is null or p_value < 0 or p_value > 100000000 then raise exception 'bad value'; end if;
  select name into v_name from players where pid = p_pid;
  if v_name is null then raise exception 'register a name first'; end if;
  if p_board = 'endless' then
    v_day := v_today; p_time := null; p_ghost := null;
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

create or replace function public.get_leaderboard_v2(
  p_board text, p_day text, p_pid text, p_limit int default 20, p_period text default 'all'
) returns json language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'utc')::date; v_result json;
begin
  if p_board is null or p_board not in ('endless', 'racepts') then raise exception 'bad board'; end if;
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

create or replace function public.get_ghosts_v2(p_day text, p_pid text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('name', name, 'ghost', ghost) order by value desc, elapsed), '[]'::json)
  from (select p.name, s.ghost, s.value, s.elapsed from score_days s join players p using (pid)
    where board = 'racepts' and day::text = p_day and s.pid <> p_pid and ghost is not null
    order by value desc, elapsed, s.pid limit 3) t;
$$;

-- Chat identities are secret browser tokens, separate from public display names.
create table if not exists public.chat_sessions (
  pid text primary key references public.players(pid),
  token_hash text not null,
  last_sent_at timestamptz,
  muted boolean not null default false
);
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  pid text not null references public.players(pid),
  body text not null check (char_length(body) between 1 and 240),
  created_at timestamptz not null default now(),
  hidden boolean not null default false
);
create index if not exists chat_recent on public.chat_messages(created_at desc) where not hidden;
create table if not exists public.chat_reports (
  message_id bigint not null references public.chat_messages(id),
  reporter_pid text not null references public.players(pid),
  created_at timestamptz not null default now(),
  primary key(message_id, reporter_pid)
);
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reports enable row level security;
revoke all on public.chat_sessions, public.chat_messages, public.chat_reports from public, anon, authenticated;
revoke all on sequence public.chat_messages_id_seq from public, anon, authenticated;

create or replace function public.open_chat_session(p_pid text, p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  if p_pid is null or p_pid !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad pid'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then raise exception 'bad token'; end if;
  if not exists(select 1 from players where pid = p_pid) then return json_build_object('ok', false, 'error', 'name_required'); end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  insert into chat_sessions(pid, token_hash) values (p_pid, v_hash) on conflict do nothing;
  if not exists(select 1 from chat_sessions where pid = p_pid and token_hash = v_hash) then
    return json_build_object('ok', false, 'error', 'identity');
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.get_chat_messages(p_pid text default '')
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'author', author, 'name', name, 'body', body,
    'created_at', created_at, 'isMe', pid = p_pid) order by id), '[]'::json)
  from (select m.id, m.pid, p.name, m.body, m.created_at,
    left(encode(sha256(convert_to(m.pid, 'UTF8')), 'hex'), 24) as author
    from chat_messages m join players p using(pid)
    where not m.hidden and m.created_at > now() - interval '7 days' order by m.id desc limit 50) t;
$$;

create or replace function public.send_chat_message(p_pid text, p_token text, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_session chat_sessions; v_body text; v_id bigint;
begin
  select * into v_session from chat_sessions where pid = p_pid
    and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found then return json_build_object('ok', false, 'error', 'identity'); end if;
  if v_session.muted then return json_build_object('ok', false, 'error', 'muted'); end if;
  if v_session.last_sent_at > now() - interval '5 seconds' then return json_build_object('ok', false, 'error', 'too_fast'); end if;
  v_body := btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]', ' ', 'g'));
  if char_length(v_body) not between 1 and 240 then return json_build_object('ok', false, 'error', 'length'); end if;
  insert into chat_messages(pid, body) values (p_pid, v_body) returning id into v_id;
  update chat_sessions set last_sent_at = now() where pid = p_pid;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.report_chat_message(p_pid text, p_token text, p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from chat_sessions where pid = p_pid and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) then
    return json_build_object('ok', false, 'error', 'identity');
  end if;
  if not exists(select 1 from chat_messages where id = p_id and pid <> p_pid and not hidden) then
    return json_build_object('ok', false, 'error', 'missing');
  end if;
  insert into chat_reports(message_id, reporter_pid) values(p_id, p_pid) on conflict do nothing;
  return json_build_object('ok', true);
end $$;

revoke all on function public.submit_score_v2(text,text,text,text,double precision,double precision,jsonb) from public;
revoke all on function public.get_leaderboard_v2(text,text,text,int,text) from public;
revoke all on function public.get_ghosts_v2(text,text) from public;
revoke all on function public.open_chat_session(text,text) from public;
revoke all on function public.get_chat_messages(text) from public;
revoke all on function public.send_chat_message(text,text,text) from public;
revoke all on function public.report_chat_message(text,text,bigint) from public;
grant execute on function public.submit_score_v2(text,text,text,text,double precision,double precision,jsonb) to anon, authenticated;
grant execute on function public.get_leaderboard_v2(text,text,text,int,text) to anon, authenticated;
grant execute on function public.get_ghosts_v2(text,text) to anon, authenticated;
grant execute on function public.open_chat_session(text,text) to anon, authenticated;
grant execute on function public.get_chat_messages(text) to anon, authenticated;
grant execute on function public.send_chat_message(text,text,text) to anon, authenticated;
grant execute on function public.report_chat_message(text,text,bigint) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
