-- Global chat shows the latest 50 messages, however old. It used to hide anything older than 7 days, so a quiet week
-- emptied the chat. Hidden (moderated) messages stay hidden. Safe to run again.
create or replace function public.get_chat_messages(p_pid text default '')
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'author', author, 'name', name, 'body', body,
    'created_at', created_at, 'isMe', pid = p_pid) order by id), '[]'::json)
  from (select m.id, m.pid, p.name, m.body, m.created_at,
    left(encode(sha256(convert_to(m.pid, 'UTF8')), 'hex'), 24) as author
    from chat_messages m join players p using(pid)
    where not m.hidden order by m.id desc limit 50) t;
$$;
notify pgrst, 'reload schema';
