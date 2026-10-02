-- Vocabulary schema. Apply only to the dedicated vocabulary Supabase project.
-- Browser roles may SELECT their own rows; all writes go through guarded RPCs.
begin;
create schema if not exists vocab_private;
revoke all on schema vocab_private from public, anon, authenticated;
grant usage on schema vocab_private to authenticated;
alter default privileges in schema vocab_private revoke execute on functions from public;

create table if not exists public.vocab_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.vocab_words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  term text not null check(length(term) between 1 and 100),
  norm_term text not null,
  context text not null default '' check(length(context)<=1500),
  norm_context text not null default '',
  sense text not null default '' check(length(sense)<=100),
  identity_hash text not null,
  definition text not null default '' check(length(definition)<=2000),
  phonetic text not null default '' check(length(phonetic)<=150),
  dictionary jsonb not null default '[]'::jsonb check(jsonb_typeof(dictionary)='array' and jsonb_array_length(dictionary)<=16),
  lookup_status text not null default 'pending' check(lookup_status in ('pending','found','not_found','unavailable')),
  created_at bigint not null default floor(extract(epoch from clock_timestamp())*1000),
  due_at bigint not null default floor(extract(epoch from clock_timestamp())*1000),
  interval_days double precision not null default 0 check(interval_days between 0 and 365),
  streak integer not null default 0 check(streak>=0),
  revision integer not null default 0 check(revision>=0),
  archived_at bigint,
  unique(user_id,identity_hash), unique(id,user_id)
);
create index if not exists vocab_words_user_due on public.vocab_words(user_id,archived_at,due_at);
create index if not exists vocab_words_user_created on public.vocab_words(user_id,created_at desc,id);
create table if not exists public.vocab_reviews (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  event_key uuid not null, fingerprint text not null, word_id uuid not null,
  term text not null, rating text not null check(rating in ('again','hard','good','easy')),
  reviewed_at bigint not null, due_before bigint not null, due_after bigint not null,
  interval_after double precision not null, streak_after integer not null, word_revision integer not null,
  timezone text not null check(length(timezone)<=100),
  unique(user_id,event_key), foreign key(word_id,user_id) references public.vocab_words(id,user_id)
);
create index if not exists vocab_reviews_user_time on public.vocab_reviews(user_id,reviewed_at desc);
create table if not exists vocab_private.rate_limits (
  user_id uuid not null, action text not null, bucket bigint not null, count integer not null,
  primary key(user_id,action,bucket)
);

alter table public.vocab_members enable row level security;
alter table public.vocab_words enable row level security;
alter table public.vocab_reviews enable row level security;
revoke all on public.vocab_members,public.vocab_words,public.vocab_reviews from public,anon,authenticated;
grant select on public.vocab_members,public.vocab_words,public.vocab_reviews to authenticated;

create or replace function vocab_private.vocab_is_member() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.vocab_members where user_id=auth.uid());
$$;
create or replace function public.vocab_is_member() returns boolean language sql stable security invoker set search_path='' as $$ select vocab_private.vocab_is_member(); $$;
revoke all on function vocab_private.vocab_is_member() from public,anon;
grant execute on function vocab_private.vocab_is_member() to authenticated;
revoke all on function public.vocab_is_member() from public,anon;
grant execute on function public.vocab_is_member() to authenticated;
drop policy if exists vocab_member_self on public.vocab_members;
create policy vocab_member_self on public.vocab_members for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists vocab_words_owner on public.vocab_words;
create policy vocab_words_owner on public.vocab_words for select to authenticated using(user_id=(select auth.uid()) and (select public.vocab_is_member()));
drop policy if exists vocab_reviews_owner on public.vocab_reviews;
create policy vocab_reviews_owner on public.vocab_reviews for select to authenticated using(user_id=(select auth.uid()) and (select public.vocab_is_member()));

create or replace function vocab_private.require_member() returns uuid language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); begin
 if u is null then raise sqlstate 'PT401' using message='Sign in required'; end if;
 if not exists(select 1 from public.vocab_members where user_id=u) then raise sqlstate 'PT403' using message='This private vocabulary is not available to this account'; end if;
 return u;
end $$;
create or replace function vocab_private.normalize_text(value text) returns text language sql immutable set search_path='' as $$
 select lower(regexp_replace(btrim(normalize(coalesce(value,''),NFKC)), '\s+', ' ', 'g'));
$$;
create or replace function vocab_private.identity_key(term text,context text,sense text) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array(vocab_private.normalize_text(term),vocab_private.normalize_text(context),vocab_private.normalize_text(sense))::text,'UTF8')),'hex');
$$;
create or replace function vocab_private.consume_rate(action_name text, maximum integer) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=vocab_private.require_member(); b bigint:=floor(extract(epoch from clock_timestamp())/60); n integer; begin
 insert into vocab_private.rate_limits(user_id,action,bucket,count) values(u,action_name,b,1)
 on conflict(user_id,action,bucket) do update set count=vocab_private.rate_limits.count+1 returning count into n;
 if n>maximum then raise sqlstate 'PT429' using message='Too many requests; try again in one minute'; end if;
 delete from vocab_private.rate_limits where user_id=u and bucket<b-2;
end $$;
revoke all on function vocab_private.require_member(),vocab_private.normalize_text(text),vocab_private.identity_key(text,text,text),vocab_private.consume_rate(text,integer) from public,anon,authenticated;

create or replace function vocab_private.vocab_import_words(p_words jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=vocab_private.require_member(); item jsonb; t text; c text; s text; k text; w public.vocab_words; saved jsonb:='[]'; n integer:=0; total integer; begin
 perform vocab_private.consume_rate('import',15);
 if p_words is null or jsonb_typeof(p_words)<>'array' or jsonb_array_length(p_words) not between 1 and 100 or octet_length(p_words::text)>220000 then raise sqlstate 'PT400' using message='Import 1–100 words per batch'; end if;
 -- Serialize imports for one owner so the capacity check and duplicate handling agree.
 perform pg_advisory_xact_lock(hashtextextended(u::text||':import',0));
 select count(*) into total from public.vocab_words where user_id=u;
 for item in select value from jsonb_array_elements(p_words) loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'term') is distinct from 'string' or (item?'context' and jsonb_typeof(item->'context')<>'string') or (item?'sense' and jsonb_typeof(item->'sense')<>'string') then raise sqlstate 'PT400' using message='Invalid word record'; end if;
  t:=btrim(normalize(item->>'term',NFKC));c:=btrim(normalize(coalesce(item->>'context',''),NFKC));s:=vocab_private.normalize_text(item->>'sense');
  if length(t) not between 1 and 100 or t!~'[A-Za-z]' or length(c)>1500 or length(s)>100 then raise sqlstate 'PT400' using message='Invalid word or context length'; end if;
  k:=vocab_private.identity_key(t,c,s);
  if exists(select 1 from public.vocab_words where user_id=u and identity_hash=k) then continue; end if;
  if total>=5000 then raise sqlstate 'PT409' using message='The 5,000-card capacity is reached; export a backup and ask the administrator to raise the limit'; end if;
  insert into public.vocab_words(user_id,term,norm_term,context,norm_context,sense,identity_hash) values(u,t,vocab_private.normalize_text(t),c,vocab_private.normalize_text(c),s,k) returning * into w;
  saved:=saved||jsonb_build_array(to_jsonb(w));n:=n+1;total:=total+1;
 end loop;
 return jsonb_build_object('words',saved,'added',n,'duplicates',jsonb_array_length(p_words)-n);
end $$;

create or replace function vocab_private.vocab_edit_word(p_id uuid,p_revision integer,p_term text default null,p_context text default null,p_sense text default null,p_definition text default null,p_archived boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=vocab_private.require_member(); w public.vocab_words; t text; c text; s text; k text; begin
 perform vocab_private.consume_rate('edit',60);
 if p_id is null or p_revision is null or p_revision<0 then raise sqlstate 'PT400' using message='Invalid identifier or revision'; end if;
 select * into w from public.vocab_words where id=p_id and user_id=u for update;
 if not found then raise sqlstate 'PT404' using message='Word not found'; end if;
 if w.revision<>p_revision then raise sqlstate 'PT409' using message='This card changed; reload before editing'; end if;
 if p_archived is not null then
  update public.vocab_words set archived_at=case when p_archived then floor(extract(epoch from clock_timestamp())*1000)::bigint else null end,revision=revision+1 where id=p_id and user_id=u returning * into w;
 else
  t:=btrim(normalize(p_term,NFKC));c:=btrim(normalize(p_context,NFKC));s:=vocab_private.normalize_text(p_sense);
  if t is null or c is null or p_sense is null or p_definition is null or length(t) not between 1 and 100 or t!~'[A-Za-z]' or length(c)>1500 or length(s)>100 or length(p_definition)>2000 then raise sqlstate 'PT400' using message='Invalid word fields'; end if;
  k:=vocab_private.identity_key(t,c,s);
  if exists(select 1 from public.vocab_words where user_id=u and identity_hash=k and id<>p_id) then raise sqlstate 'PT409' using message='This exact word, context and sense already exists'; end if;
  update public.vocab_words set term=t,norm_term=vocab_private.normalize_text(t),context=c,norm_context=vocab_private.normalize_text(c),sense=s,identity_hash=k,definition=p_definition,
   dictionary=case when norm_term<>vocab_private.normalize_text(t) then '[]'::jsonb else dictionary end,
   phonetic=case when norm_term<>vocab_private.normalize_text(t) then '' else phonetic end,
   lookup_status=case when norm_term<>vocab_private.normalize_text(t) then 'pending' else lookup_status end,revision=revision+1
   where id=p_id and user_id=u returning * into w;
 end if;
 return to_jsonb(w);
exception when unique_violation then raise sqlstate 'PT409' using message='This exact word, context and sense already exists';
end $$;

create or replace function vocab_private.vocab_review_word(p_id uuid,p_revision integer,p_event_key uuid,p_rating text,p_timezone text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=vocab_private.require_member(); w public.vocab_words; r public.vocab_reviews; fp text; n bigint; days double precision; next_streak integer; begin
 if p_id is null or p_event_key is null or p_revision is null or p_revision<0 or p_rating is null or p_rating not in ('again','hard','good','easy') or p_timezone is null or length(p_timezone)>100 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise sqlstate 'PT400' using message='Invalid review'; end if;
 fp:=jsonb_build_array(p_id,p_revision,p_rating,p_timezone)::text;
 -- Serialize one user's key even if concurrent requests name different words.
 perform pg_advisory_xact_lock(hashtextextended(u::text||':review:'||p_event_key::text,0));
 select * into r from public.vocab_reviews where user_id=u and event_key=p_event_key;
 if found then
  if r.fingerprint<>fp then raise sqlstate 'PT409' using message='This review key was used with another payload'; end if;
  return jsonb_build_object('replayed',true,'review',to_jsonb(r));
 end if;
 perform vocab_private.consume_rate('review',90);
 select * into w from public.vocab_words where id=p_id and user_id=u and archived_at is null for update;
 if not found then raise sqlstate 'PT404' using message='Word not found or archived'; end if;
 if w.revision<>p_revision then raise sqlstate 'PT409' using message='This card was updated or already reviewed; reload'; end if;
 n:=floor(extract(epoch from clock_timestamp())*1000);
 days:=least(365,case p_rating when 'again' then 10.0/1440 when 'hard' then greatest(1,w.interval_days*1.2) when 'good' then case when w.streak=0 then 1 else greatest(3,w.interval_days*2) end else greatest(3,w.interval_days*3) end);
 next_streak:=case when p_rating='again' then 0 else w.streak+1 end;
 insert into public.vocab_reviews(user_id,event_key,fingerprint,word_id,term,rating,reviewed_at,due_before,due_after,interval_after,streak_after,word_revision,timezone)
 values(u,p_event_key,fp,p_id,w.term,p_rating,n,w.due_at,n+round(days*86400000)::bigint,days,next_streak,w.revision,p_timezone) returning * into r;
 update public.vocab_words set due_at=r.due_after,interval_days=days,streak=next_streak,revision=revision+1 where id=p_id and user_id=u returning * into w;
 return jsonb_build_object('replayed',false,'review',to_jsonb(r),'word',to_jsonb(w));
end $$;

create or replace function vocab_private.vocab_lookup_budget() returns void language plpgsql security definer set search_path='' as $$ begin perform vocab_private.consume_rate('lookup',80); end $$;
create or replace function vocab_private.vocab_enrich_word(p_id uuid,p_term text,p_dictionary jsonb,p_phonetic text,p_status text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=vocab_private.require_member(); w public.vocab_words; m jsonb; begin
 perform vocab_private.consume_rate('enrich',80);
 if p_id is null or p_term is null or p_dictionary is null or jsonb_typeof(p_dictionary)<>'array' or jsonb_array_length(p_dictionary)>16 or octet_length(p_dictionary::text)>60000 or p_phonetic is null or length(p_phonetic)>150 or p_status is null or p_status not in ('found','not_found','unavailable') then raise sqlstate 'PT400' using message='Invalid dictionary data'; end if;
 for m in select value from jsonb_array_elements(p_dictionary) loop
  if jsonb_typeof(m)<>'object' or jsonb_typeof(m->'definition') is distinct from 'string' or jsonb_typeof(m->'partOfSpeech') is distinct from 'string' or jsonb_typeof(m->'example') is distinct from 'string' or length(m->>'definition')>1200 or length(m->>'partOfSpeech')>30 or length(m->>'example')>1000 then raise sqlstate 'PT400' using message='Invalid dictionary meaning'; end if;
 end loop;
 update public.vocab_words set dictionary=p_dictionary,phonetic=p_phonetic,lookup_status=p_status where id=p_id and user_id=u and term=p_term and archived_at is null returning * into w;
 if not found then
  if not exists(select 1 from public.vocab_words where id=p_id and user_id=u) then raise sqlstate 'PT404' using message='Word not found'; end if;
  raise sqlstate 'PT409' using message='Word changed or was archived during lookup';
 end if;
 return to_jsonb(w);
end $$;


-- Public RPCs are invoker wrappers; privileged code stays in an unexposed schema.
create or replace function public.vocab_import_words(p_words jsonb) returns jsonb language sql security invoker set search_path='' as $$ select vocab_private.vocab_import_words(p_words); $$;
revoke all on function vocab_private.vocab_import_words(jsonb) from public,anon;
grant execute on function vocab_private.vocab_import_words(jsonb) to authenticated;
create or replace function public.vocab_edit_word(p_id uuid,p_revision integer,p_term text default null,p_context text default null,p_sense text default null,p_definition text default null,p_archived boolean default null) returns jsonb language sql security invoker set search_path='' as $$ select vocab_private.vocab_edit_word(p_id,p_revision,p_term,p_context,p_sense,p_definition,p_archived); $$;
revoke all on function vocab_private.vocab_edit_word(uuid,integer,text,text,text,text,boolean) from public,anon;
grant execute on function vocab_private.vocab_edit_word(uuid,integer,text,text,text,text,boolean) to authenticated;
create or replace function public.vocab_review_word(p_id uuid,p_revision integer,p_event_key uuid,p_rating text,p_timezone text) returns jsonb language sql security invoker set search_path='' as $$ select vocab_private.vocab_review_word(p_id,p_revision,p_event_key,p_rating,p_timezone); $$;
revoke all on function vocab_private.vocab_review_word(uuid,integer,uuid,text,text) from public,anon;
grant execute on function vocab_private.vocab_review_word(uuid,integer,uuid,text,text) to authenticated;
create or replace function public.vocab_lookup_budget() returns void language sql security invoker set search_path='' as $$ select vocab_private.vocab_lookup_budget(); $$;
revoke all on function vocab_private.vocab_lookup_budget() from public,anon;
grant execute on function vocab_private.vocab_lookup_budget() to authenticated;
create or replace function public.vocab_enrich_word(p_id uuid,p_term text,p_dictionary jsonb,p_phonetic text,p_status text) returns jsonb language sql security invoker set search_path='' as $$ select vocab_private.vocab_enrich_word(p_id,p_term,p_dictionary,p_phonetic,p_status); $$;
revoke all on function vocab_private.vocab_enrich_word(uuid,text,jsonb,text,text) from public,anon;
grant execute on function vocab_private.vocab_enrich_word(uuid,text,jsonb,text,text) to authenticated;

revoke all on function public.vocab_import_words(jsonb),public.vocab_edit_word(uuid,integer,text,text,text,text,boolean),public.vocab_review_word(uuid,integer,uuid,text,text),public.vocab_lookup_budget(),public.vocab_enrich_word(uuid,text,jsonb,text,text) from public,anon;
grant execute on function public.vocab_import_words(jsonb),public.vocab_edit_word(uuid,integer,text,text,text,text,boolean),public.vocab_review_word(uuid,integer,uuid,text,text),public.vocab_lookup_budget(),public.vocab_enrich_word(uuid,text,jsonb,text,text) to authenticated;
commit;
