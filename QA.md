# Supabase/Vercel migration QA

## Current checks

- TypeScript: passed locally
- Standard Next.js production build: passed locally
- PGlite PostgreSQL contract: 23 passed locally, 8 native-only cases skipped locally
- Native PostgreSQL 17: all 31 database tests passed in GitHub CI, including the 8 concurrency cases
- Authentication failure-path regressions: 9 passed locally
- Actual Next.js HTTP smoke: setup-required redirect, fail-closed APIs and PWA asset headers passed
- CI repeats native PostgreSQL, auth regression, type, build and runtime-smoke checks for each commit; PGlite alone is not evidence of concurrency safety

The database suite bootstraps disposable Supabase-style roles and `auth.uid()` fixtures, then applies the actual application migrations. It tests PostgreSQL behavior, not a mock implementation of the application SQL.

## Scope to verify before production

- Real Supabase GoTrue/JWT/cookie refresh and magic-link email delivery
- Exact production membership and RLS advisor checks on the dedicated project
- Real Vercel project build, environment variables and callback URLs
- Desktop and narrow/mobile UI screenshots and keyboard/cancel/back-forward/repeated-click flows
- PWA installation, offline transition and browser speech
- Live dictionary service availability and WebMCP in a supported browser

The cloud development browser blocked the loopback preview with `net::ERR_BLOCKED_BY_CLIENT`. That restriction was not bypassed. Build and SQL tests are not a substitute for real-browser acceptance testing.

No production Supabase database or Vercel website has been provisioned by this code change. Do not label a source-only prerelease “deployed” or “production-ready.”
