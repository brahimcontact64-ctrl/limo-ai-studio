-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.complete_registration_profile_v2(
  p_first_name text,
  p_last_name text,
  p_country_name text,
  p_country_code text,
  p_state_region text,
  p_date_of_birth date,
  p_account_type text,
  p_terms_version text,
  p_safety_policy_version text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=now();
  v_code text:=upper(left(regexp_replace(coalesce(p_country_code,''),'[^A-Za-z]','','g'),3));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_date_of_birth is null or p_date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'LIMO launch accounts are restricted to users age 18 or older';
  end if;
  if btrim(coalesce(p_first_name,''))='' or btrim(coalesce(p_last_name,''))='' then raise exception 'Name required'; end if;
  if btrim(coalesce(p_country_name,''))='' then raise exception 'Country required'; end if;
  if char_length(v_code) not between 2 and 3 then raise exception 'Country code required'; end if;
  if btrim(coalesce(p_state_region,''))='' then raise exception 'State/region required'; end if;
  if p_account_type not in ('creator','business','agency') then raise exception 'Invalid account type'; end if;
  if btrim(coalesce(p_terms_version,''))='' or btrim(coalesce(p_safety_policy_version,''))='' then raise exception 'Policy acceptance required'; end if;

  insert into public.user_profiles(
    user_id,first_name,last_name,country_name,country_code,state_region,date_of_birth,account_type,
    terms_version,safety_policy_version,accepted_at,registration_completed_at,updated_at
  )
  values(
    auth.uid(),left(btrim(p_first_name),80),left(btrim(p_last_name),80),left(btrim(p_country_name),120),
    v_code,left(btrim(p_state_region),120),p_date_of_birth,p_account_type,
    left(btrim(p_terms_version),40),left(btrim(p_safety_policy_version),40),v_now,v_now,v_now
  )
  on conflict (user_id) do update set
    first_name=excluded.first_name,last_name=excluded.last_name,country_name=excluded.country_name,
    country_code=excluded.country_code,state_region=excluded.state_region,account_type=excluded.account_type,
    terms_version=excluded.terms_version,safety_policy_version=excluded.safety_policy_version,
    accepted_at=v_now,updated_at=v_now
  where public.user_profiles.date_of_birth=excluded.date_of_birth;

  if not found then raise exception 'Date of birth cannot be changed after registration without support review'; end if;

  insert into public.policy_acceptance_events(user_id,policy_key,version,source,accepted_at)
  values
    (auth.uid(),'terms',left(p_terms_version,40),'onboarding',v_now),
    (auth.uid(),'safety',left(p_safety_policy_version,40),'onboarding',v_now),
    (auth.uid(),'age_attestation','18plus-v1','onboarding',v_now),
    (auth.uid(),'content_rights','rights-v1','onboarding',v_now);
end;
$$;
revoke all on function public.complete_registration_profile_v2(text,text,text,text,text,date,text,text,text) from public,anon;
grant execute on function public.complete_registration_profile_v2(text,text,text,text,text,date,text,text,text) to authenticated,service_role;
