-- LIMO AI Studio — per-user rate limiting v1
-- Status: PENDING OWNER APPROVAL for production. Additive.
--
-- hit_rate_limit(action, limit, window_seconds) counts calls per signed-in user in fixed windows and
-- returns false once the limit is reached. Used inside sensitive SECURITY DEFINER functions and by
-- API routes (via RPC) for actions such as payment submission, AI drafts and publishing.

create table if not exists public.rate_limit_hits (
  user_id uuid not null,
  action text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, action, window_start)
);
alter table public.rate_limit_hits enable row level security;
-- No policies: only SECURITY DEFINER functions touch this table.

create or replace function public.hit_rate_limit(p_action text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_window timestamptz;
  v_hits integer;
begin
  if v_uid is null then return false; end if;
  if p_limit < 1 or p_window_seconds < 1 or char_length(coalesce(p_action, '')) not between 1 and 60 then
    raise exception 'Invalid rate limit';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_hits(user_id, action, window_start, hits)
  values (v_uid, p_action, v_window, 1)
  on conflict (user_id, action, window_start) do update set hits = public.rate_limit_hits.hits + 1
  returning hits into v_hits;

  -- Opportunistic cleanup of this user's old windows.
  delete from public.rate_limit_hits where user_id = v_uid and window_start < now() - interval '2 days';
  return v_hits <= p_limit;
end;
$function$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.hit_rate_limit(text, integer, integer) to authenticated;
