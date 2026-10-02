# English Vocabulary

A desktop-first vocabulary PWA on Next.js, with Neon Postgres and managed Neon Auth, hosted on Vercel. Both the database and Vercel Functions use Singapore.

## Features

- Paste words, lists, passages, or import a UTF-8 TXT file
- Select words/phrases and preserve sentence context before saving
- Exact term/context/sense deduplication; distinct senses remain separate cards
- Save first, then English dictionary lookup with graceful failure
- Browser speech, editable English/Chinese notes, archive/restore and JSON export
- Spaced practice with server-computed UTC schedules and idempotent history
- Email code sign-in, automatic first-time account creation, and server-checked sessions
- Responsive layout, app manifest and privacy-safe offline fallback

Phone layout is basic; OCR/camera and advanced mobile capture are deferred. Automatic Chinese translation is not implemented. Only selected terms go to Free Dictionary API, never full context sentences.

## Local setup

Requires Node.js 22.13+ and PostgreSQL. Copy `.env.example` to `.env.local` and set:

- `DATABASE_URL`: Neon pooled connection, for application traffic
- `DATABASE_URL_UNPOOLED`: Neon direct connection, for migrations
- `NEON_AUTH_BASE_URL`: Neon Console → Auth → Configuration
- `NEON_AUTH_COOKIE_SECRET`: random secret of at least 32 characters

With the linked Vercel project, `npx vercel env pull .env.local` retrieves development settings. Back up local-only values before pulling.

```sh
npm install
npm run db:migrate
npm run dev
npm run typecheck
npm run build
```

Migrations in `db/migrations` run transactionally over the direct connection and record checksums in `vocabulary_migrations.applied`. Re-running skips applied migrations; editing an applied migration is rejected.

## API integration tests

Run against a test database with migrations applied. Set the same `TEST_AUTH_SECRET` in the server and test process, then run `npm run test:api`; `BASE_URL` defaults to `http://localhost:3000`.

`TEST_AUTH_SECRET` enables test identity headers only outside Vercel production. Never configure it on Vercel. The API suite checks isolation, normalized deduplication, concurrent review updates, idempotency, validation, and dictionary lookup.

## Deployment (Neon + Vercel)

1. Provision Neon Free through Vercel Marketplace in Singapore (`sin1`), with Auth enabled; connect it to the Vercel project. The integration provides database and Auth URL variables.
2. Add a cryptographically random `NEON_AUTH_COOKIE_SECRET` to Vercel Production/Preview as a secret, and Development for local use.
3. Apply migrations using the direct connection. Keep database credentials server-only.
4. Deploy with `npx vercel deploy --prod`. `vercel.json` pins Functions to `sin1`.
5. In Neon Auth, allow the exact deployed HTTPS origin. Localhost is pre-approved by default. Email OTP requires email sign-in/sign-up to be enabled.
6. Open `/login`, request a code, and enter the six-digit code. First-time sign-in creates an account. Codes, delivery and attempt limits are managed by Neon.

Neon's shared email sender supports initial testing. Configure dedicated SMTP before a public production rollout; delivery limits and reputation are shared on the default sender. No paid SMTP service is provisioned automatically.

## Data and limits

- Saved words/history use Postgres, never localStorage
- Server routes validate Neon Auth sessions, filter every data operation by the verified user id, and reject cross-origin writes
- App tables have RLS enabled with no public policies; the server uses its database owner connection
- Only capture drafts are device-local; offline mutations are not queued
- The service worker caches no private API data, only the offline screen and icons
- 20,000-character capture, 80 KB TXT, 100 records/import; field sizes and request rates are bounded
- History UI/export shows the newest 300 events; all review events remain in Postgres
- Review intervals: Again 10 minutes; Hard at least 1 day; Good 1 day initially then at least 3; Easy at least 3; later intervals grow and cap at 365 days
- This is a simple interval heuristic, not a validated learning optimization claim
- Installation and speech depend on browser/OS support; the offline screen is not full offline learning
- Neon Free suspends idle compute; the next request can take longer while it resumes

## API

`GET/POST/PATCH /api/words`, `GET/POST /api/reviews`, `POST /api/lookup`.

Every data route requires a verified session. Client identity headers are never trusted in production. Dictionary fetches use one fixed HTTPS destination with timeout and response-size bounds; redirects are not followed.
