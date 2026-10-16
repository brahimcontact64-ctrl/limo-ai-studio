-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

alter table public.character_catalog add column if not exists family_code text;
alter table public.character_catalog add column if not exists age_group text;
alter table public.character_catalog add column if not exists gender_code text;
alter table public.character_catalog add column if not exists reference_status text not null default 'pending';
alter table public.character_catalog add column if not exists visual_description text;
create index if not exists character_catalog_family_variant_idx on public.character_catalog(family_code,age_group,gender_code);
insert into public.character_catalog(id,name,emoji,tone,tier,active,sort_order,family_code,age_group,gender_code,reference_status,visual_description)
select f.code||'_'||v.code,
       f.title||' '||v.title,
       f.emoji,
       case when v.age='child' then 'playful and curious' when v.age='elder' then 'warm and wise' else 'expressive and confident' end,
       'standard',true,
       f.rank*100+v.rank,
       f.code,v.age,v.gender,'pending',
       'Consistent stylized 3D anthropomorphic '||f.fruit||' character; '||v.details||'. Preserve the original family color, face, leafy crown and proportions.'
from (values
('limo','Limo','🍅','tomato',1),
('nova','Nova','🍓','strawberry',2),
('adam','Adam','🥔','potato',3)
) as f(code,title,emoji,fruit,rank)
cross join (values
('boy','Boy','child','male',1,'young boy, playful casual clothing'),
('girl','Girl','child','female',2,'young girl, playful casual clothing'),
('man','Man','adult','male',3,'adult man, contemporary clothing'),
('woman','Woman','adult','female',4,'adult woman, contemporary clothing'),
('elder_man','Elder Man','elder','male',5,'elderly man, gentle age details, dignified clothing'),
('elder_woman','Elder Woman','elder','female',6,'elderly woman, gentle age details, dignified clothing')
) as v(code,title,age,gender,rank,details)
on conflict(id) do update set
 family_code=excluded.family_code,
 age_group=excluded.age_group,
 gender_code=excluded.gender_code,
 visual_description=excluded.visual_description,
 sort_order=excluded.sort_order,
 updated_at=now();
