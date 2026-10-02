# English Vocabulary · Supabase + Vercel

A desktop-first vocabulary PWA built with Next.js, Supabase Auth and PostgreSQL.
以電腦操作為主的英文詞彙 PWA，使用 Next.js、Supabase 登入及 PostgreSQL。

## Status / 目前狀態

This branch migrates the existing MVP from Sites/Cloudflare D1 to **Supabase + Vercel**, preserving its capture and practice UI. It is source code and a testable deployment candidate, **not a claim that production is connected or live**.

目前是可測試的部署候選版本。正式 Supabase 專案、帳號授權、Vercel 權限與環境變數仍需完成設定；沒有假登入或以 localStorage 代替後端。

The original D1 implementation is preserved in the main branch history. Retained starter files under `build/`, `drizzle/` and the logical Sites manifest are inactive in this version. `npm run dev/build/start` now run standard Next.js. No Sites identity headers are trusted.

## Implemented / 已實作

- Paste a word, list or passage; import a small UTF-8 TXT file
- Select words/phrases and retain sentence context; confirm each batch before saving
- Exact term/context/sense deduplication; different senses remain separate cards
- Save first, then optionally fetch English definitions from Free Dictionary API
- Browser pronunciation, English/Chinese personal notes, reversible archive and JSON export
- Short spaced-practice sessions with server-calculated schedules and idempotent review history
- Basic phone layout, installable PWA metadata and an identity-free offline fallback
- Supabase magic-link login, verified server sessions and deny-by-default membership

No forced categories. OCR/camera capture and native Windows/macOS installers are not part of this PWA build. Automatic Chinese translation is not implemented; you may write your own Chinese meaning.

## Run locally / 本機執行

Node.js 22.13+ is required; CI uses Node 24.

```sh
npm run install:ci
cp .env.example .env.local
# Fill in the dedicated vocabulary project's public values.
npm run dev
```

Open the Next.js local URL, normally http://localhost:3000. Without valid Supabase settings, the app shows a setup-required screen and rejects data APIs. It never enables a production mock user.

Required variables:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Dedicated Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key, intended for browser use |
| `NEXT_PUBLIC_SITE_URL` | Canonical app origin, e.g. http://localhost:3000 locally |

No service-role key, database password or Supabase secret key is used by this app. Never place them in `NEXT_PUBLIC_*` values, source control or the browser. Public project keys are safe only with the included database privileges/RLS correctly applied.

## Dedicated Supabase setup / 專用資料庫設定

Use a **new dedicated vocabulary project**. Do not apply these migrations to an unrelated work or HPK database.

1. Review project costs and select the organization/region before project creation
2. Apply every SQL migration in `supabase/migrations/`, in filename order, through the approved Supabase migration workflow or SQL editor
3. Create/invite the intended owner through Supabase Auth's supported dashboard flow
4. Copy that verified Auth user's UUID, then add it to the allowlist as an administrator:

```sql
insert into public.vocab_members (user_id)
values ('REPLACE_WITH_VERIFIED_AUTH_USER_UUID')
on conflict (user_id) do nothing;
```

The placeholder is intentionally not a valid UUID. Do not guess an ID, use email matching or let the first visitor claim ownership. Without an allowlist entry, everyone is denied.

5. Disable public signup and unused auth providers for this private project
6. Set the Auth Site URL to the app's canonical origin and allow only its exact `/auth/callback` URL (plus a separately approved local/preview URL when needed)
7. Verify email delivery before calling the app ready

### Magic-link email

The UI requests a login link with `shouldCreateUser: false`. Open it in the same browser/device that requested it because the flow uses PKCE. Expired or wrong-browser links return a retry message.

Supabase's default SMTP has recipient and rate restrictions. It may only send to organization-team email addresses and is not a general production mail service. Numeric email OTP would require a compatible email template configuration; this app does not depend on that feature. Configure custom SMTP only if needed and separately authorized.

## Deploy to Vercel / 部署

1. Import this repository into an authorized Vercel account/team as a dedicated project
2. Select the **Next.js** framework; `vercel.json` supplies the standard build settings
3. Add the three environment variables to the intended environments using the provider's secure settings flow
4. Deploy this tested commit and verify the build logs, login callback and real database access
5. Complete desktop and narrow-screen browser acceptance tests before promoting a release to production-ready

A connected plugin alone does not prove access to a particular Vercel team or Supabase project. Deployment must not reuse another app's account/project scope by assumption. No provider secrets are checked into this repository and CI does not deploy.

## Validate / 測試

```sh
npm run typecheck
npm run test:auth
npm run test:locale
npm run test:enrichment
npm run test:db
npm run build
npm run test:smoke
```

The local SQL suite uses PGlite to execute actual PostgreSQL migrations, roles, privileges, RLS and RPC transactions without a live account. For true simultaneous-connection tests, point `TEST_DATABASE_URL` at a **disposable local/CI PostgreSQL server only**. The test harness creates its own temporary database; never give it a production URL. CI runs PostgreSQL 17 and the native race tests.

See [QA.md](QA.md) for passed checks, remaining browser/provider coverage and the difference between local SQL tests and real Supabase authentication.

## Security model

- Every Next.js data API verifies the current user with Supabase `auth.getUser()`
- The cookie client is created per request; session refresh cookies and private/no-store headers are preserved
- RLS limits reads to the caller's UUID and current membership
- App roles cannot insert, update, delete, truncate or self-enroll directly through tables
- Public RPCs are `SECURITY INVOKER` wrappers; guarded privileged implementations live in unexposed `vocab_private`
- Every write RPC repeats membership, ownership, validation and rate checks in SQL, so direct RPC calls cannot bypass app-server rules
- Reviews use transaction-scoped key locks, owner row locks, unique keys and a payload fingerprint; retries cannot advance the schedule twice
- The membership list has no browser-write path and no email/user-metadata authorization shortcut
- Dictionary requests have one fixed HTTPS destination, no redirect following, a timeout and response-size limits

## Data and practical limits

Saved words/reviews are PostgreSQL records. Only unsaved capture/staged drafts are browser-local and user-keyed. The service worker stores no private API responses. Offline writes/reviews are not queued.

Capture is limited to 20,000 characters / 80 KB TXT; imports contain 1–100 cards; a user has a 5,000-card capacity enforced atomically. Duplicate-only imports still work at capacity. Reads are paginated so no older cards are silently omitted. History UI/export shows the newest 300 review events while all history stays in the database.

The review schedule is a simple interval heuristic: Again 10 minutes; Hard at least 1 day; Good 1 day initially and then at least 3; Easy at least 3; later intervals grow and cap at 365 days. Times are server-owned UTC instants displayed in the device's timezone.

Installation and speech depend on browser/OS support. The offline screen is not a full offline learning mode. A GitHub source release is not a Windows executable or a live deployment.

## Primary references

- [Supabase Next.js SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
- [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase passwordless sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase SMTP limits](https://supabase.com/docs/guides/auth/auth-smtp)
- [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)

The hardening migration revokes the migration owner's global default function execution grants, because PostgreSQL schema-scoped revokes cannot remove a global default. This is another reason these migrations belong only in the dedicated vocabulary project.

## Lookup recovery / 自動查詢續接

Pending or temporarily unavailable definitions resume when the app is opened online. Each queue allows at most 40 requests/minute with five bounded attempts and increasing delays; the database remains the authoritative 80/minute per-user limit across tabs. Retry timing and the last selected tab are device-local and user-keyed. Concurrent tabs do not have an atomic shared browser queue. A 429 pause survives a normal reopen. Real not-found results are not retried forever.

Completed definitions remain in PostgreSQL and are reused without calling the provider again. A late failed response cannot erase a successful same-term definition after the preservation migration is applied. Provider failures are categorized without logging the user's term or sentence. This does not guarantee that the free provider is reachable, and lookup work is resumed on reopen rather than completed by a background job while the browser is closed.

Stored words and completed reviews persist. The last tab and capture draft are restored; an unfinished review queue is not yet resumable. Login lifetime and review scheduling are unchanged. Browser-storage failures show a warning instead of silently promising local persistence.
