-- Peak Flip owner tools: messages to everyone playing, calling riders to Off-piste, and admins.
-- Paste this whole file into Supabase → SQL Editor → Run (or: supabase db query --linked --file supabase/admin.sql).
-- Safe to run again. Needs schema.sql and points-and-chat.sql first.
--
-- Use it from the SQL Editor:
--   select pf_announce('Double coins weekend starts now!');      -- a pop-up for everyone playing (shows for 3 minutes)
--   select pf_announce('Server maintenance soon', 10);            -- keep it up for 10 minutes for people who come in
--   select pf_send_to_offpiste('SomeName');                       -- take one player to Off-piste
--   select pf_send_to_offpiste();                                 -- take everyone playing right now to Off-piste
--   select pf_make_admin('SomeName');                             -- admin, can fly on Off-piste (F)
--   select pf_make_admin('SomeName', false);                      -- admin without flying
--   select pf_remove_admin('SomeName');
--   select p.name, a.can_fly, a.created_at from admins a join players p using (pid);   -- who's admin
-- Admins can also type in the Off-piste chat: /say <message>, /send <name>, /send all, /fly
begin;
create table if not exists public.admins (
  pid text primary key references public.players(pid),
  can_fly boolean not null default true,
  last_cmd_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.game_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('notice', 'offpiste')),
  body text check (body is null or char_length(body) between 1 and 240),
  target_pid text references public.players(pid),   -- null: everyone
  created_by text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 minutes',
  done_at timestamptz                                  -- when the targeted player picked it up
);
create index if not exists game_events_live on public.game_events(expires_at, id);
create index if not exists game_events_target on public.game_events(target_pid) where target_pid is not null and done_at is null;
alter table public.admins enable row level security;
alter table public.game_events enable row level security;
revoke all on public.admins, public.game_events from public, anon, authenticated;
revoke all on sequence public.game_events_id_seq from public, anon, authenticated;

-- what every player asks for every 10 seconds: anything new for everyone since the last event they saw,
-- anything waiting just for them, and whether they're an admin
create or replace function public.get_game_events(p_pid text, p_after bigint default 0)
returns json language plpgsql security definer set search_path = public as $$
declare v_events json; v_admin admins;
begin
  if p_pid is null or p_pid !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad pid'; end if;
  p_after := coalesce(p_after, 0);
  select coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'body', body) order by id), '[]'::json) into v_events
  from (select id, kind, body from game_events where expires_at > now()
    and ((target_pid is null and id > p_after) or (target_pid = p_pid and done_at is null))
    order by id limit 20) t;
  update game_events set done_at = now() where target_pid = p_pid and done_at is null and expires_at > now();
  select * into v_admin from admins where pid = p_pid;
  return json_build_object('events', v_events, 'last', (select coalesce(max(id), 0) from game_events),
    'admin', v_admin.pid is not null, 'fly', coalesce(v_admin.can_fly, false));
end $$;

create or replace function public.pf_pid(p_name text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_pid text;
begin
  select pid into v_pid from players where lower(name) = lower(btrim(p_name));
  if v_pid is null then raise exception 'no player called %', p_name; end if;
  return v_pid;
end $$;

create or replace function public.pf_announce(p_body text, p_minutes int default 3) returns text
language plpgsql security definer set search_path = public as $$
declare v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]', ' ', 'g'));
begin
  if char_length(v_body) not between 1 and 240 then raise exception 'write between 1 and 240 characters'; end if;
  insert into game_events(kind, body, expires_at, created_by)
  values ('notice', v_body, now() + make_interval(mins => least(greatest(coalesce(p_minutes, 3), 1), 1440)), 'owner');
  return 'Sent to everyone playing: ' || v_body;
end $$;

create or replace function public.pf_send_to_offpiste(p_name text default null) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_name is null or lower(btrim(p_name)) in ('', 'all', 'everyone') then
    -- only people playing in the next minute; anyone who opens the game later isn't pulled in
    insert into game_events(kind, expires_at, created_by) values ('offpiste', now() + interval '1 minute', 'owner');
    return 'Everyone playing is on their way to Off-piste';
  end if;
  insert into game_events(kind, target_pid, expires_at, created_by) values ('offpiste', pf_pid(p_name), now() + interval '10 minutes', 'owner');
  return p_name || ' goes to Off-piste next time their game checks in (within 10 minutes)';
end $$;

create or replace function public.pf_make_admin(p_name text, p_fly boolean default true) returns text
language plpgsql security definer set search_path = public as $$
begin
  insert into admins(pid, can_fly) values (pf_pid(p_name), coalesce(p_fly, true))
  on conflict (pid) do update set can_fly = excluded.can_fly;
  return p_name || ' is an admin' || case when coalesce(p_fly, true) then ' and can fly on Off-piste' else '' end;
end $$;

create or replace function public.pf_remove_admin(p_name text) returns text
language plpgsql security definer set search_path = public as $$
begin
  delete from admins where pid = pf_pid(p_name);
  return p_name || ' is no longer an admin';
end $$;

-- admins from inside the game (Off-piste chat): checked with the same secret token as the global chat
create or replace function public.admin_command(p_pid text, p_token text, p_cmd text, p_arg text)
returns json language plpgsql security definer set search_path = public as $$
declare v_admin admins; v_arg text := btrim(regexp_replace(coalesce(p_arg, ''), '[[:cntrl:]]', ' ', 'g')); v_target text;
begin
  if not exists(select 1 from chat_sessions where pid = p_pid and token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')) then
    return json_build_object('ok', false, 'error', 'identity');
  end if;
  select * into v_admin from admins where pid = p_pid for update;
  if not found then return json_build_object('ok', false, 'error', 'not_admin'); end if;
  if v_admin.last_cmd_at > now() - interval '3 seconds' then return json_build_object('ok', false, 'error', 'too_fast'); end if;
  if p_cmd = 'say' then
    if char_length(v_arg) not between 1 and 240 then return json_build_object('ok', false, 'error', 'length'); end if;
    insert into game_events(kind, body, created_by) values ('notice', v_arg, p_pid);
  elsif p_cmd = 'send' then
    if lower(v_arg) in ('all', 'everyone') then
      insert into game_events(kind, expires_at, created_by) values ('offpiste', now() + interval '1 minute', p_pid);
    else
      select pid into v_target from players where lower(name) = lower(v_arg);
      if v_target is null then return json_build_object('ok', false, 'error', 'unknown_player'); end if;
      insert into game_events(kind, target_pid, expires_at, created_by) values ('offpiste', v_target, now() + interval '10 minutes', p_pid);
    end if;
  else
    return json_build_object('ok', false, 'error', 'unknown_command');
  end if;
  update admins set last_cmd_at = now() where pid = p_pid;
  return json_build_object('ok', true);
end $$;

-- players can only call get_game_events and admin_command; the pf_ tools are for the SQL Editor only
revoke all on function public.get_game_events(text, bigint) from public, anon, authenticated;
revoke all on function public.admin_command(text, text, text, text) from public, anon, authenticated;
revoke all on function public.pf_pid(text) from public, anon, authenticated;
revoke all on function public.pf_announce(text, int) from public, anon, authenticated;
revoke all on function public.pf_send_to_offpiste(text) from public, anon, authenticated;
revoke all on function public.pf_make_admin(text, boolean) from public, anon, authenticated;
revoke all on function public.pf_remove_admin(text) from public, anon, authenticated;
grant execute on function public.get_game_events(text, bigint) to anon, authenticated;
grant execute on function public.admin_command(text, text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
