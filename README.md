# English Vocabulary

A desktop-first English vocabulary PWA on Next.js with Supabase (Postgres + Auth), hosted on Vercel.
以電腦操作為主的英文詞彙 PWA，包含真正的後端 API 與持久化資料庫。


## Status / 目前狀態

Source, migration and API integration tests (run against real Postgres). Nothing is deployed until you follow **Deployment** below.

## Features

- Paste words/lists/passages or import a UTF-8 TXT file
- Select words/phrases and preserve sentence context; confirm before saving
- Exact term/context/sense deduplication; distinct senses remain separate cards
- Save first, then English dictionary lookup with graceful failure
- Browser speech, editable English/Chinese notes, archive/restore and JSON export
- Spaced practice with server-computed UTC schedules and idempotent history
- Responsive layout, app manifest and privacy-safe offline fallback

Phone layout is basic; OCR/camera and advanced mobile capture are deferred. Automatic Chinese translation is not implemented. Only selected terms go to Free Dictionary API, never full context sentences.


## Local setup

Node.js 22.13+ and a Postgres (a Supabase project or local Postgres 16).

```sh
cp .env.example .env.local      # fill in Supabase URL, anon key, DATABASE_URL
psql "$DATABASE_URL" -f supabase/migrations/20261002000000_init.sql
npm install
npm run dev
```

```sh
npm run typecheck
npm run build && TEST_AUTH_SECRET=local npm start &   # same secret in the server env
TEST_AUTH_SECRET=local npm run test:api               # BASE_URL defaults to http://localhost:3000
```

`TEST_AUTH_SECRET` enables an `x-test-user` header for the API suite only; it is ignored when `VERCEL_ENV=production`. Never set it in production.

## Deployment (Supabase + Vercel)

1. **Supabase**: create a project. Run `supabase/migrations/20261002000000_init.sql` in the SQL editor (or `supabase db push`). RLS is enabled with no policies, so the public API cannot touch the tables; the server connects directly.
2. **Supabase Auth**: Authentication → URL Configuration → set *Site URL* to your Vercel domain and add `https://YOUR-DOMAIN/auth/callback` (and `http://localhost:3000/auth/callback`) to *Redirect URLs*. Email magic links are used; the built-in mailer is rate-limited, so configure custom SMTP for real use.
3. **Vercel**: import the repo (framework: Next.js, defaults). Set environment variables for Production/Preview:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings → API)
   - `DATABASE_URL`: Supabase *Transaction pooler* string (port 6543), required for serverless
4. Deploy, open the site, request a magic link and sign in.

Users are identified by the verified Supabase user id (`auth.getUser()`); client headers are never trusted.

## Data and limits

- Saved words/history use Supabase Postgres, never localStorage
- Only capture drafts are device-local; offline mutations are not queued
- Service worker caches no private API data, only the offline screen and icons
- 20,000-character capture, 80 KB TXT, 100 records/import; field sizes and request rates are bounded
- History UI/export shows the newest 300 events; all review events remain in Postgres
- Review intervals: Again 10 minutes; Hard at least 1 day; Good 1 day initially then at least 3; Easy at least 3; later intervals grow and cap at 365 days
- This is a simple interval heuristic, not a validated learning optimization claim
- Installation and speech depend on browser/OS support; the offline screen is not full offline learning

## API

`GET/POST/PATCH /api/words`, `GET/POST /api/reviews`, `POST /api/lookup`.
Every route requires a verified Supabase Auth session. Writes use validation, owner scoping and same-origin checks. Dictionary fetches use one fixed HTTPS destination, timeout and response-size bound; redirects are not followed.
