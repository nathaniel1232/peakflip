-- Run with: supabase db query --linked --file supabase/tests/vault.sql
-- Every test write is rolled back, so test players never reach the live game.
begin;
do $$
declare
  pids text[] := array[]::text[];
  p text;
  poor text := 'pf_qa_' || replace(gen_random_uuid()::text, '-', '');
  nameless text := 'pf_qa_' || replace(gen_random_uuid()::text, '-', '');
  result json;
  sold int := 0;
begin
  for i in 1..6 loop
    p := 'pf_qa_' || replace(gen_random_uuid()::text, '-', '');
    pids := pids || p;
    perform change_name(p, 'Vault QA ' || i);
    insert into saves (pid, code, data, saved_at) values (p, upper(substr(md5(p), 1, 10)), '{"coins": 12000000, "inv": {"outfit": ["rookie"]}}', 100);
  end loop;
  -- the right number of coins is required
  perform change_name(poor, 'Vault Poor');
  insert into saves (pid, code, data, saved_at) values (poor, upper(substr(md5(poor), 1, 10)), '{"coins": 9999999, "inv": {"outfit": ["rookie"]}}', 100);
  assert (claim_vault(poor, 'horizon')->>'error') = 'coins', 'too few coins is refused';
  -- a leaderboard name is required, so the owner list can show who it is
  assert (claim_vault(nameless, 'horizon')->>'error') = 'no_name', 'a player without a name is refused';
  -- buyers get it until the cap, then it's sold out (live owners count toward the cap too)
  foreach p in array pids loop
    result := claim_vault(p, 'horizon');
    if (result->>'ok')::boolean then
      sold := sold + 1;
      assert (select (data->>'coins')::numeric from saves where pid = p) = 2000000, 'the price is taken from the save';
      assert (select data->'inv'->'outfit' ? 'horizon' from saves where pid = p), 'the outfit lands in the save';
      assert (select saved_at from saves where pid = p) = 101, 'the save is marked newer';
      assert (claim_vault(p, 'horizon')->>'already')::boolean, 'claiming twice is harmless';
      assert (select (data->>'coins')::numeric from saves where pid = p) = 2000000, 'claiming twice costs nothing';
    else
      assert (result->>'error') = 'sold_out', 'after the cap it is sold out';
    end if;
  end loop;
  assert (select count(*) from vault_owners where item = 'horizon') = 5, 'never more than 5 owners';
  result := get_vault('horizon', pids[1]);
  assert json_array_length(result->'owners') = 5, 'get_vault lists every owner';
  assert (result->>'max')::int = 5 and (result->>'price')::bigint = 10000000, 'get_vault reports the terms';
end $$;
rollback;
