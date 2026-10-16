begin;

create extension if not exists pgcrypto;

-- ---------- Catalog ----------
create table if not exists public.plan_definitions (
  code text primary key,
  name text not null,
  monthly_dzd integer not null check (monthly_dzd > 0),
  redotpay_usdt numeric(10,2) not null check (redotpay_usdt > 0),
  video_slots integer not null check (video_slots >= 0),
  posts integer not null check (posts >= 0),
  facebook_pages integer not null check (facebook_pages >= 0),
  ai_images integer not null check (ai_images >= 0),
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.addon_definitions (
  code text primary key,
  name text not null,
  price_dzd integer not null check (price_dzd > 0),
  price_usdt numeric(10,2) not null check (price_usdt > 0),
  resource text not null check (resource in ('video','post','image','facebook_page')),
  units integer not null check (units > 0),
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.character_catalog (
  id text primary key,
  name text not null,
  emoji text not null default '🎬',
  tone text not null,
  tier text not null default 'standard' check (tier in ('standard','premium')),
  voice_provider text,
  voice_ref text,
  visual_provider text,
  visual_ref text,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.language_catalog (
  code text primary key,
  label text not null,
  native_name text not null,
  locale text not null,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plan_definitions(code,name,monthly_dzd,redotpay_usdt,video_slots,posts,facebook_pages,ai_images,sort_order)
values
 ('starter','Starter',5900,23,6,30,1,10,10),
 ('creator','Creator',12900,50,15,90,3,30,20),
 ('business','Business',24900,95,30,250,10,80,30)
on conflict (code) do update set
 name=excluded.name,monthly_dzd=excluded.monthly_dzd,redotpay_usdt=excluded.redotpay_usdt,
 video_slots=excluded.video_slots,posts=excluded.posts,facebook_pages=excluded.facebook_pages,
 ai_images=excluded.ai_images,sort_order=excluded.sort_order,updated_at=now();

insert into public.addon_definitions(code,name,price_dzd,price_usdt,resource,units,sort_order)
values
 ('video_1','+1 video slot',800,3.2,'video',1,10),
 ('video_5','+5 video slots',3500,13.5,'video',5,20),
 ('video_10','+10 video slots',6500,25,'video',10,30),
 ('posts_25','+25 posts',900,3.5,'post',25,40),
 ('facebook_page_1','+1 Facebook page',1500,6,'facebook_page',1,50)
on conflict (code) do update set
 name=excluded.name,price_dzd=excluded.price_dzd,price_usdt=excluded.price_usdt,
 resource=excluded.resource,units=excluded.units,sort_order=excluded.sort_order,updated_at=now();

insert into public.character_catalog(id,name,emoji,tone,tier,sort_order)
values
 ('limo','Limo','🍋','Friendly · energetic · educational','standard',10),
 ('nova','Nova','✨','Modern · confident · concise','standard',20),
 ('adam','Adam','🧑‍💼','Professional · clear · trustworthy','standard',30)
on conflict (id) do update set name=excluded.name,emoji=excluded.emoji,tone=excluded.tone,tier=excluded.tier,sort_order=excluded.sort_order,updated_at=now();

insert into public.language_catalog(code,label,native_name,locale,sort_order)
values
 ('ar','Arabic','العربية','ar',10),
 ('fr','French','Français','fr',20),
 ('en','English','English','en',30),
 ('de','German','Deutsch','de',40)
on conflict (code) do update set label=excluded.label,native_name=excluded.native_name,locale=excluded.locale,sort_order=excluded.sort_order,updated_at=now();

-- ---------- Billing / usage ----------
create table if not exists public.organization_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_code text not null references public.plan_definitions(code),
  status text not null default 'pending' check (status in ('pending','active','past_due','canceled')),
  started_at timestamptz,
  renews_at timestamptz,
  source_payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_balances (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  cycle_start timestamptz not null,
  cycle_end timestamptz not null,
  base_video_slots integer not null default 0 check (base_video_slots >= 0),
  extra_video_slots integer not null default 0 check (extra_video_slots >= 0),
  used_video_slots integer not null default 0 check (used_video_slots >= 0),
  base_posts integer not null default 0 check (base_posts >= 0),
  extra_posts integer not null default 0 check (extra_posts >= 0),
  used_posts integer not null default 0 check (used_posts >= 0),
  base_images integer not null default 0 check (base_images >= 0),
  extra_images integer not null default 0 check (extra_images >= 0),
  used_images integer not null default 0 check (used_images >= 0),
  base_facebook_pages integer not null default 0 check (base_facebook_pages >= 0),
  extra_facebook_pages integer not null default 0 check (extra_facebook_pages >= 0),
  used_facebook_pages integer not null default 0 check (used_facebook_pages >= 0),
  updated_at timestamptz not null default now(),
  check (cycle_end > cycle_start)
);

create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  resource text not null check (resource in ('video','post','image','facebook_page')),
  delta integer not null,
  reason text not null,
  reference_type text,
  reference_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists usage_ledger_org_created_idx on public.usage_ledger(organization_id,created_at desc);

create table if not exists public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  purchase_type text not null check (purchase_type in ('subscription','addon')),
  item_code text not null,
  method text not null check (method in ('redotpay','baridimob','ccp')),
  amount_dzd integer check (amount_dzd is null or amount_dzd > 0),
  amount_usdt numeric(12,2) check (amount_usdt is null or amount_usdt > 0),
  transaction_ref text not null check (char_length(btrim(transaction_ref)) between 3 and 200),
  receipt_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_dzd is not null or amount_usdt is not null)
);
create index if not exists payment_submissions_org_status_idx on public.payment_submissions(organization_id,status,created_at desc);

alter table public.organization_subscriptions
  drop constraint if exists organization_subscriptions_source_payment_id_fkey;
alter table public.organization_subscriptions
  add constraint organization_subscriptions_source_payment_id_fkey foreign key (source_payment_id) references public.payment_submissions(id) on delete set null;

-- ---------- Feedback ----------
create table if not exists public.feedback_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('feature','bug','pricing','product','other')),
  importance text not null check (importance in ('nice','important','blocking')),
  message text not null check (char_length(message) between 5 and 4000),
  status text not null default 'new' check (status in ('new','reviewing','planned','closed')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_items_org_created_idx on public.feedback_items(organization_id,created_at desc);

-- ---------- Social account metadata (no plaintext provider tokens) ----------
create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('facebook')),
  external_user_id text,
  token_secret_ref text,
  status text not null default 'connected' check (status in ('connected','expired','revoked')),
  expires_at timestamptz,
  connected_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,provider,external_user_id)
);

create table if not exists public.facebook_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.social_connections(id) on delete cascade,
  page_id text not null,
  page_name text not null,
  token_secret_ref text,
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,page_id)
);
create index if not exists facebook_pages_org_selected_idx on public.facebook_pages(organization_id,selected);

-- ---------- Durable content job queue ----------
create table if not exists public.content_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  resource text not null check (resource in ('video','post','image')),
  units integer not null check (units > 0 and units <= 10),
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','canceled')),
  provider text,
  provider_job_id text,
  provider_cost_cents integer check (provider_cost_cents is null or provider_cost_cents >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(organization_id,idempotency_key)
);
create index if not exists content_jobs_queue_idx on public.content_jobs(status,available_at,created_at);
create index if not exists content_jobs_org_created_idx on public.content_jobs(organization_id,created_at desc);

-- ---------- Helper role check ----------
create or replace function public.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  );
$$;

revoke all on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;

-- ---------- Payment approval ----------
create or replace function public.approve_payment_submission(p_payment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payment_submissions%rowtype;
  v_plan public.plan_definitions%rowtype;
  v_addon public.addon_definitions%rowtype;
  v_now timestamptz := now();
begin
  select * into v_payment from public.payment_submissions where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if not public.is_org_admin(v_payment.organization_id) then raise exception 'Not authorized'; end if;
  if v_payment.status <> 'pending' then raise exception 'Payment already reviewed'; end if;

  if v_payment.purchase_type = 'subscription' then
    select * into v_plan from public.plan_definitions where code = v_payment.item_code and active = true;
    if not found then raise exception 'Unknown plan'; end if;
    if v_payment.method='redotpay' then
      if v_payment.amount_usdt is null or v_payment.amount_usdt < v_plan.redotpay_usdt then raise exception 'Payment amount below plan price'; end if;
    else
      if v_payment.amount_dzd is null or v_payment.amount_dzd < v_plan.monthly_dzd then raise exception 'Payment amount below plan price'; end if;
    end if;

    insert into public.organization_subscriptions(organization_id,plan_code,status,started_at,renews_at,source_payment_id,updated_at)
    values(v_payment.organization_id,v_plan.code,'active',v_now,v_now + interval '30 days',v_payment.id,v_now)
    on conflict (organization_id) do update set
      plan_code=excluded.plan_code,status='active',started_at=excluded.started_at,renews_at=excluded.renews_at,
      source_payment_id=excluded.source_payment_id,updated_at=v_now;

    insert into public.usage_balances(
      organization_id,cycle_start,cycle_end,
      base_video_slots,extra_video_slots,used_video_slots,
      base_posts,extra_posts,used_posts,
      base_images,extra_images,used_images,
      base_facebook_pages,extra_facebook_pages,used_facebook_pages,updated_at)
    values(v_payment.organization_id,v_now,v_now + interval '30 days',
      v_plan.video_slots,0,0,v_plan.posts,0,0,v_plan.ai_images,0,0,v_plan.facebook_pages,0,0,v_now)
    on conflict (organization_id) do update set
      cycle_start=excluded.cycle_start,cycle_end=excluded.cycle_end,
      base_video_slots=excluded.base_video_slots,extra_video_slots=0,used_video_slots=0,
      base_posts=excluded.base_posts,extra_posts=0,used_posts=0,
      base_images=excluded.base_images,extra_images=0,used_images=0,
      base_facebook_pages=excluded.base_facebook_pages,extra_facebook_pages=0,used_facebook_pages=least(public.usage_balances.used_facebook_pages,excluded.base_facebook_pages),
      updated_at=v_now;

  elsif v_payment.purchase_type = 'addon' then
    select * into v_addon from public.addon_definitions where code = v_payment.item_code and active = true;
    if not found then raise exception 'Unknown add-on'; end if;
    if v_payment.method='redotpay' then
      if v_payment.amount_usdt is null or v_payment.amount_usdt < v_addon.price_usdt then raise exception 'Payment amount below add-on price'; end if;
    else
      if v_payment.amount_dzd is null or v_payment.amount_dzd < v_addon.price_dzd then raise exception 'Payment amount below add-on price'; end if;
    end if;
    perform 1 from public.usage_balances where organization_id=v_payment.organization_id and cycle_end > v_now for update;
    if not found then raise exception 'No active billing cycle'; end if;

    if v_addon.resource='video' then
      update public.usage_balances set extra_video_slots=extra_video_slots+v_addon.units,updated_at=v_now where organization_id=v_payment.organization_id;
    elsif v_addon.resource='post' then
      update public.usage_balances set extra_posts=extra_posts+v_addon.units,updated_at=v_now where organization_id=v_payment.organization_id;
    elsif v_addon.resource='image' then
      update public.usage_balances set extra_images=extra_images+v_addon.units,updated_at=v_now where organization_id=v_payment.organization_id;
    elsif v_addon.resource='facebook_page' then
      update public.usage_balances set extra_facebook_pages=extra_facebook_pages+v_addon.units,updated_at=v_now where organization_id=v_payment.organization_id;
    end if;

    insert into public.usage_ledger(organization_id,resource,delta,reason,reference_type,reference_id,created_by)
    values(v_payment.organization_id,v_addon.resource,v_addon.units,'addon_purchase','payment',v_payment.id,auth.uid());
  else
    raise exception 'Unsupported purchase type';
  end if;

  update public.payment_submissions set status='approved',reviewed_by=auth.uid(),reviewed_at=v_now,updated_at=v_now where id=v_payment.id;
  return 'approved';
end;
$$;

revoke all on function public.approve_payment_submission(uuid) from public, anon;
grant execute on function public.approve_payment_submission(uuid) to authenticated, service_role;

-- ---------- Atomic usage reservation + durable enqueue ----------
create or replace function public.enqueue_content_job(
  p_organization_id uuid,
  p_idempotency_key text,
  p_resource text,
  p_units integer,
  p_job_type text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_usage public.usage_balances%rowtype;
  v_job_id uuid;
  v_remaining integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key)='' or char_length(p_idempotency_key)>160 then raise exception 'Invalid idempotency key'; end if;
  if p_resource not in ('video','post','image') then raise exception 'Unsupported resource'; end if;
  if p_units < 1 or p_units > 10 then raise exception 'Invalid units'; end if;

  select id into v_existing from public.content_jobs where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;

  perform 1 from public.organization_subscriptions
    where organization_id=p_organization_id and status='active' and renews_at>now();
  if not found then raise exception 'Active subscription required'; end if;

  select * into v_usage from public.usage_balances where organization_id=p_organization_id for update;
  if not found or v_usage.cycle_end<=now() then raise exception 'Billing cycle unavailable'; end if;

  if p_resource='video' then
    v_remaining := (v_usage.base_video_slots + v_usage.extra_video_slots) - v_usage.used_video_slots;
    if v_remaining < p_units then raise exception 'Video slot limit reached'; end if;
    update public.usage_balances set used_video_slots=used_video_slots+p_units,updated_at=now() where organization_id=p_organization_id;
  elsif p_resource='post' then
    v_remaining := (v_usage.base_posts + v_usage.extra_posts) - v_usage.used_posts;
    if v_remaining < p_units then raise exception 'Post limit reached'; end if;
    update public.usage_balances set used_posts=used_posts+p_units,updated_at=now() where organization_id=p_organization_id;
  else
    v_remaining := (v_usage.base_images + v_usage.extra_images) - v_usage.used_images;
    if v_remaining < p_units then raise exception 'Image limit reached'; end if;
    update public.usage_balances set used_images=used_images+p_units,updated_at=now() where organization_id=p_organization_id;
  end if;

  insert into public.content_jobs(organization_id,requested_by,idempotency_key,resource,units,job_type,payload)
  values(p_organization_id,auth.uid(),p_idempotency_key,p_resource,p_units,left(p_job_type,100),coalesce(p_payload,'{}'::jsonb))
  returning id into v_job_id;

  insert into public.usage_ledger(organization_id,resource,delta,reason,reference_type,reference_id,created_by)
  values(p_organization_id,p_resource,-p_units,'job_reserved','content_job',v_job_id,auth.uid());

  return v_job_id;
exception when unique_violation then
  select id into v_existing from public.content_jobs where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  raise;
end;
$$;

revoke all on function public.enqueue_content_job(uuid,text,text,integer,text,jsonb) from public, anon;
grant execute on function public.enqueue_content_job(uuid,text,text,integer,text,jsonb) to authenticated, service_role;

-- ---------- RLS ----------
alter table public.plan_definitions enable row level security;
alter table public.addon_definitions enable row level security;
alter table public.character_catalog enable row level security;
alter table public.language_catalog enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.usage_balances enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.payment_submissions enable row level security;
alter table public.feedback_items enable row level security;
alter table public.social_connections enable row level security;
alter table public.facebook_pages enable row level security;
alter table public.content_jobs enable row level security;

-- Catalog is public read-only.
drop policy if exists plan_catalog_read on public.plan_definitions;
create policy plan_catalog_read on public.plan_definitions for select using (active=true);
drop policy if exists addon_catalog_read on public.addon_definitions;
create policy addon_catalog_read on public.addon_definitions for select using (active=true);
drop policy if exists character_catalog_read on public.character_catalog;
create policy character_catalog_read on public.character_catalog for select using (active=true);
drop policy if exists language_catalog_read on public.language_catalog;
create policy language_catalog_read on public.language_catalog for select using (active=true);

-- Tenant-scoped reads.
drop policy if exists subscription_member_read on public.organization_subscriptions;
create policy subscription_member_read on public.organization_subscriptions for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists usage_member_read on public.usage_balances;
create policy usage_member_read on public.usage_balances for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists usage_ledger_member_read on public.usage_ledger;
create policy usage_ledger_member_read on public.usage_ledger for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists payment_member_read on public.payment_submissions;
create policy payment_member_read on public.payment_submissions for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists payment_member_insert on public.payment_submissions;
create policy payment_member_insert on public.payment_submissions for insert to authenticated with check (public.is_org_member(organization_id) and submitted_by=auth.uid());
drop policy if exists feedback_member_read on public.feedback_items;
create policy feedback_member_read on public.feedback_items for select to authenticated using (organization_id is null and user_id=auth.uid() or public.is_org_member(organization_id));
drop policy if exists feedback_member_insert on public.feedback_items;
create policy feedback_member_insert on public.feedback_items for insert to authenticated with check (user_id=auth.uid() and (organization_id is null or public.is_org_member(organization_id)));
drop policy if exists social_member_read on public.social_connections;
create policy social_member_read on public.social_connections for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists social_admin_write on public.social_connections;
create policy social_admin_write on public.social_connections for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
drop policy if exists pages_member_read on public.facebook_pages;
create policy pages_member_read on public.facebook_pages for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists pages_admin_write on public.facebook_pages;
create policy pages_admin_write on public.facebook_pages for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
drop policy if exists jobs_member_read on public.content_jobs;
create policy jobs_member_read on public.content_jobs for select to authenticated using (public.is_org_member(organization_id));

-- Hard privilege reductions: authenticated users cannot directly mutate protected billing/usage/job tables.
revoke insert,update,delete,truncate on public.organization_subscriptions from authenticated, anon;
revoke insert,update,delete,truncate on public.usage_balances from authenticated, anon;
revoke insert,update,delete,truncate on public.usage_ledger from authenticated, anon;
revoke update,delete,truncate on public.payment_submissions from authenticated, anon;
revoke update,delete,truncate on public.feedback_items from authenticated, anon;
revoke insert,update,delete,truncate on public.content_jobs from authenticated, anon;

-- Explicit normal grants where RLS is intended to allow access.
grant select on public.plan_definitions,public.addon_definitions,public.character_catalog,public.language_catalog to anon,authenticated;
grant select on public.organization_subscriptions,public.usage_balances,public.usage_ledger,public.payment_submissions,public.feedback_items,public.social_connections,public.facebook_pages,public.content_jobs to authenticated;
grant insert on public.payment_submissions,public.feedback_items to authenticated;
grant insert,update,delete on public.social_connections,public.facebook_pages to authenticated;

commit;
