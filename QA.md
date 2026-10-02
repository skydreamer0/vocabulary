# QA record — 2026-10-02

Deployment: https://english-vocabulary-puce.vercel.app
Vercel deployment: dpl_EtzKVLVRtmTAGZmsR81FaKNwgFCv (production, READY).
Neon project: dark-scene-55246572, Free plan, Singapore.
Vercel Functions: sin1, confirmed by deployment inspection.

## Verified

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
