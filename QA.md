# QA record — 2026-10-02

Deployment: https://english-vocabulary-puce.vercel.app
Vercel deployment: dpl_5bfCWFLDKeykazv5uP4W7sCoiGXd (production, READY; application commit 2980335).
Neon project: dark-scene-55246572, Free plan, Singapore.
Vercel Functions: sin1, confirmed by deployment inspection.

## Verified

- Reconciled the former Supabase branch into the Neon implementation: retained Taiwan localization, resumable/bounded dictionary enrichment, defensive response parsing and auth-outage handling.
- 3 localization checks and 29 dictionary/queue/HTTP checks passed; actual Postgres temporary-table tests passed for successful-definition preservation, user isolation, renamed words and archived words.
- Auth outage regression passed with an intentionally unreachable provider: HTTP 503 without a login redirect or cleared cookies; failed sign-out redirects to an explicit retry page.
- Production build and TypeScript passed after integration. The real API suite passed again, including archived lookup rejection, with its generated fixtures cleaned up.
- GitHub CI passed for application commit 2980335: https://github.com/skydreamer0/vocabulary/actions/runs/36987041722.
- After redeployment, live auth smoke tests passed and the existing signed-in browser loaded the Traditional Chinese UI and cloud vocabulary. No error-level deployment logs were found in the verification window.

- Next.js production build and TypeScript check passed after the Neon Auth migration.
- Lint passed for changed auth components, auth routes, proxy, migration runner and auth smoke tests.
- Applied the initial schema transactionally over the Neon direct connection; words, reviews and rate_limits have RLS enabled.
- The real Postgres API integration suite passed: missing identity, cross-user isolation, cross-origin rejection, deduplication, distinct senses, 100-word import, concurrent review submissions, idempotent retries, stale revisions, archive preservation, malformed inputs/timezones and live dictionary enrichment.
- Removed the exact two test users' vocabulary/review/rate-limit fixtures after the suite.
- Live production auth smoke tests passed: home redirects to login; login renders; anonymous session is null; forged user headers fail; protected APIs return private/no-store 401 responses; cross-origin sign-in/sign-out fail; invalid OTP returns INVALID_OTP.
- Production login page inspected in the browser. No database passwords or session secrets are exposed through public environment variables.
- User confirmed successful email OTP login. The authenticated production vocabulary page was inspected, and reloading preserved the signed-in session.
- Vercel environment variables verified; TEST_AUTH_SECRET is absent.
- No error-level production logs found during the initial verification window.

## Remaining verification / limitations

- Neon Console SSO continued to request email verification in the assistant browser, so no manual trusted-domain change was made. Same-origin OTP requests reached Neon successfully. No OAuth or email-link redirects are used.
- Neon shared SMTP is used for initial/personal testing. Configure dedicated SMTP before a public production rollout.
- Full repository lint still reports pre-existing issues in app/vocabulary-app.tsx (explicit any, render-time purity/ref access, effect state updates, and navigation). The changed auth files are clean.
- Mobile interaction, installation/offline/speech, and cross-device sessions have not been re-tested in this migration.

CI uses PostgreSQL 16 and test-only identity headers; it does not send real email and does not deploy. Run npm run test:auth against the local or deployed app for live auth boundary checks without sending email.
