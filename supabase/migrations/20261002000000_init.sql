create table if not exists public.words (
  id text primary key,
  user_id text not null,
  term text not null,
  norm_term text not null,
  context text not null default '',
  norm_context text not null default '',
  sense text not null default '',
  definition text not null default '',
  phonetic text not null default '',
  dictionary text not null default '[]',
  lookup_status text not null default 'pending',
  created_at bigint not null,
  due_at bigint not null,
  interval_days double precision not null default 0,
  streak integer not null default 0,
  revision integer not null default 0,
  archived_at bigint
);
create unique index if not exists idx_words_identity on public.words (user_id, norm_term, norm_context, sense);
create index if not exists idx_words_user_due on public.words (user_id, archived_at, due_at);

create table if not exists public.reviews (
  id text primary key,
  user_id text not null,
  event_key text not null,
  fingerprint text not null,
  word_id text not null references public.words (id),
  term text not null,
  rating text not null,
  reviewed_at bigint not null,
  due_before bigint not null,
  due_after bigint not null,
  interval_after double precision not null,
  streak_after integer not null,
  word_revision integer not null,
  timezone text not null
);
create unique index if not exists idx_reviews_user_event on public.reviews (user_id, event_key);
create index if not exists idx_reviews_user_time on public.reviews (user_id, reviewed_at);

create table if not exists public.rate_limits (
  key text primary key,
  count integer not null,
  expires_at bigint not null
);

-- The app reaches Postgres only through the server (DATABASE_URL) and filters by
-- the verified user id. Enabling RLS with no policies blocks the public
-- PostgREST/anon API from reading or writing these tables.
alter table public.words enable row level security;
alter table public.reviews enable row level security;
alter table public.rate_limits enable row level security;
