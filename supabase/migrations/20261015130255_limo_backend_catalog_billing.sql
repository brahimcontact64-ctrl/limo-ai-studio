-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create extension if not exists pgcrypto;

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
create unique index if not exists payment_submissions_method_ref_uidx on public.payment_submissions(method,transaction_ref);

alter table public.organization_subscriptions
  drop constraint if exists organization_subscriptions_source_payment_id_fkey;
alter table public.organization_subscriptions
  add constraint organization_subscriptions_source_payment_id_fkey foreign key (source_payment_id) references public.payment_submissions(id) on delete set null;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

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
