-- The vault: Event Horizon costs 10,000,000 coins and only 5 players can ever own it.
-- Paste into Supabase → SQL Editor → Run, after schema.sql and names.sql. Safe to run again.
--  · claim_vault takes the coins from the player's cloud save and records them as an owner in one transaction.
--    A lock per item means two players buying at the same moment can never make a 6th copy.
--  · get_vault lists the owners (by their current leaderboard name), so the shop can show who has one.
--  · Coins live in the player's own save, which the browser writes, so this trusts the same numbers the
--    Coins leaderboard does (whole numbers up to 100,000,000).
begin;

create table if not exists public.vault_owners (
  item text not null,
  pid text not null references public.players (pid) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (item, pid)
);
alter table public.vault_owners enable row level security;   -- no policies: only the functions below touch it
revoke all on public.vault_owners from anon, authenticated;

create or replace function public.vault_price(p_item text) returns bigint
language sql immutable set search_path = public as $$
  select case p_item when 'horizon' then 10000000 end;
$$;
create or replace function public.vault_max(p_item text) returns int
language sql immutable set search_path = public as $$
  select case p_item when 'horizon' then 5 end;
$$;

create or replace function public.get_vault(p_item text, p_pid text default null) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'item', p_item, 'price', vault_price(p_item), 'max', vault_max(p_item),
    'owners', coalesce((select json_agg(json_build_object('name', p.name, 'at', v.claimed_at, 'isMe', v.pid = p_pid) order by v.claimed_at)
      from vault_owners v join players p using (pid) where v.item = p_item), '[]'::json),
    'mine', exists (select 1 from vault_owners where item = p_item and pid = p_pid)
  ) where vault_price(p_item) is not null;
$$;

create or replace function public.claim_vault(p_pid text, p_item text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_price bigint := vault_price(p_item);
  v_max int := vault_max(p_item);
  v_data jsonb;
  v_coins numeric;
begin
  if p_pid is null or p_pid !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad pid'; end if;
  if v_price is null then raise exception 'bad item'; end if;
  perform pg_advisory_xact_lock(hashtext('vault:' || p_item));
  if exists (select 1 from vault_owners where item = p_item and pid = p_pid) then
    return json_build_object('ok', true, 'already', true);
  end if;
  if (select count(*) from vault_owners where item = p_item) >= v_max then
    return json_build_object('ok', false, 'error', 'sold_out');
  end if;
  if not exists (select 1 from players where pid = p_pid) then
    return json_build_object('ok', false, 'error', 'no_name');
  end if;
  select data into v_data from saves where pid = p_pid for update;
  if v_data is null or jsonb_typeof(v_data -> 'coins') <> 'number' or (v_data ->> 'coins') !~ '^\d{1,9}$' then
    return json_build_object('ok', false, 'error', 'no_save');
  end if;
  v_coins := (v_data ->> 'coins')::numeric;
  if v_coins > 100000000 or v_coins < v_price then
    return json_build_object('ok', false, 'error', 'coins', 'coins', v_coins);
  end if;
  -- take the coins and put the outfit in the cloud save, one tick newer than the copy the game just uploaded,
  -- so a device that never hears back still picks up the purchase instead of overwriting it
  v_data := jsonb_set(v_data, '{coins}', to_jsonb(v_coins - v_price));
  if not coalesce((v_data -> 'inv' -> 'outfit') ? p_item, false) then
    v_data := jsonb_set(v_data, '{inv,outfit}', coalesce(v_data -> 'inv' -> 'outfit', '[]'::jsonb) || to_jsonb(p_item), true);
  end if;
  update saves set data = v_data, saved_at = saved_at + 1, updated_at = now() where pid = p_pid;
  insert into vault_owners (item, pid) values (p_item, p_pid);
  return json_build_object('ok', true, 'coins', v_coins - v_price,
    'left', v_max - (select count(*) from vault_owners where item = p_item));
end $$;

revoke all on function public.get_vault(text, text) from public;
revoke all on function public.claim_vault(text, text) from public;
grant execute on function public.get_vault(text, text) to anon, authenticated;
grant execute on function public.claim_vault(text, text) to anon, authenticated;

commit;
