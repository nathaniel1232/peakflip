-- Idiot, the secret card game: points played for, the overall points board and who owes whom.
-- Before a game the lobby agrees on a stake. The first human out wins it and the last human (the Idiot) loses it,
-- so the loser owes the winner that many points; everyone else is neutral. Debts between two players are netted.
-- The game's host reports each finished game once (its id is unique). Safe to run again.
-- A player's id is the first 16 hex characters of sha256(their secret key). Lobbies only ever see the id; the key
-- (kept in the player's save) is what reads "mine" on the board and marks debts owed to you as paid.
begin;

create table if not exists public.idiot_players (
  pid text primary key,
  name text not null,
  points integer not null default 0,
  games integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.idiot_games (
  id text primary key,
  stake integer not null,
  winner text not null,
  loser text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.idiot_debts (
  id bigint generated always as identity primary key,
  debtor text not null,
  creditor text not null,
  amount integer not null check (amount > 0),
  updated_at timestamptz not null default now(),
  unique (debtor, creditor)
);

alter table public.idiot_players enable row level security;
alter table public.idiot_games enable row level security;
alter table public.idiot_debts enable row level security;
revoke all on public.idiot_players, public.idiot_games, public.idiot_debts from anon, authenticated;

-- p_players: every human at the table, [{ "pid": ..., "name": ... }]
create or replace function public.idiot_result(p_game text, p_stake integer, p_winner text, p_loser text, p_players jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_p jsonb;
  v_pid text;
  v_name text;
  v_back integer;
begin
  if p_game is null or p_game !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad game'; end if;
  if p_stake is null or p_stake < 1 or p_stake > 1000 then raise exception 'bad stake'; end if;
  if p_winner is null or p_loser is null or p_winner = p_loser then raise exception 'bad players'; end if;
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players) not between 2 and 6 then raise exception 'bad players'; end if;
  if not exists(select 1 from jsonb_array_elements(p_players) e where e ->> 'pid' = p_winner)
     or not exists(select 1 from jsonb_array_elements(p_players) e where e ->> 'pid' = p_loser) then raise exception 'bad players'; end if;

  insert into idiot_games (id, stake, winner, loser) values (p_game, p_stake, p_winner, p_loser) on conflict (id) do nothing;
  if not found then return json_build_object('ok', true, 'repeat', true); end if;

  for v_p in select * from jsonb_array_elements(p_players) loop
    v_pid := v_p ->> 'pid';
    v_name := clean_name(v_p ->> 'name');
    if v_pid is null or v_pid !~ '^[0-9a-f]{16}$' or length(v_name) < 1 then raise exception 'bad players'; end if;
    insert into idiot_players as ip (pid, name, points, games, wins, losses)
    values (v_pid, v_name,
      case when v_pid = p_winner then p_stake when v_pid = p_loser then -p_stake else 0 end, 1,
      (v_pid = p_winner)::int, (v_pid = p_loser)::int)
    on conflict (pid) do update set
      name = excluded.name, points = ip.points + excluded.points, games = ip.games + 1,
      wins = ip.wins + excluded.wins, losses = ip.losses + excluded.losses, updated_at = now();
  end loop;

  -- the loser owes the winner; first cancel out what the winner already owed the loser
  select amount into v_back from idiot_debts where debtor = p_winner and creditor = p_loser for update;
  if v_back is not null then
    if v_back > p_stake then
      update idiot_debts set amount = amount - p_stake, updated_at = now() where debtor = p_winner and creditor = p_loser;
      return json_build_object('ok', true);
    end if;
    delete from idiot_debts where debtor = p_winner and creditor = p_loser;
    p_stake := p_stake - v_back;
  end if;
  if p_stake > 0 then
    insert into idiot_debts as d (debtor, creditor, amount) values (p_loser, p_winner, p_stake)
    on conflict (debtor, creditor) do update set amount = d.amount + excluded.amount, updated_at = now();
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.idiot_pid(p_key text) returns text language sql immutable as $$
  select case when p_key ~ '^[A-Za-z0-9_-]{16,128}$' then left(encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), 16) end;
$$;

-- the points board and the open debts; "mine" marks debts owed to the key's player, which only they can mark paid
drop function if exists public.idiot_board(text);
create or replace function public.idiot_board(p_key text default null)
returns json language sql stable security definer set search_path = public as $$
  with me as (select idiot_pid(p_key) as pid)
  select json_build_object(
    'players', coalesce((select json_agg(x) from (
      select name, points, games, wins, losses, coalesce(pid = (select pid from me), false) as me from idiot_players
      order by points desc, wins desc, games asc limit 100) x), '[]'::json),
    'debts', coalesce((select json_agg(x) from (
      select d.id, a.name as debtor, b.name as creditor, d.amount,
        coalesce(d.creditor = (select pid from me), false) as mine, coalesce(d.debtor = (select pid from me), false) as owe
      from idiot_debts d join idiot_players a on a.pid = d.debtor join idiot_players b on b.pid = d.creditor
      order by coalesce(d.creditor = (select pid from me) or d.debtor = (select pid from me), false) desc, d.amount desc limit 100) x), '[]'::json));
$$;

drop function if exists public.idiot_paid(text, bigint);
create or replace function public.idiot_paid(p_key text, p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
begin
  delete from idiot_debts where id = p_id and creditor = idiot_pid(p_key);
  return json_build_object('ok', found);
end $$;

revoke all on function public.idiot_result(text, integer, text, text, jsonb) from public;
revoke all on function public.idiot_board(text) from public;
revoke all on function public.idiot_paid(text, bigint) from public;
revoke all on function public.idiot_pid(text) from public;
grant execute on function public.idiot_result(text, integer, text, text, jsonb) to anon, authenticated;
grant execute on function public.idiot_board(text) to anon, authenticated;
grant execute on function public.idiot_paid(text, bigint) to anon, authenticated;
commit;
