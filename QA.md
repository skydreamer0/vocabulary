# QA record

Passed: TypeScript check; production build; actual compiled Worker/D1 integration tests for missing identity, cross-user isolation, cross-origin rejection, duplicate normalization, separate senses, 100-word import, concurrent same-key review, payload-bound retries, competing stale revisions, archive preservation, malformed inputs/timezones, fixed-endpoint dictionary parsing and 404/redirect/malformed/oversized failures, authenticated server rendering.

An independent read-only review found client save/refresh/session races; the fixes were rechecked. Source/staged drafts persist locally, due cards recompute on time/focus, newer revisions are retained, and import/review navigation is guarded while saving.

Not yet verified: actual desktop/narrow browser screenshots and interactive keyboard/cancel/back-forward/double-click flows; install/offline/speech behavior in a real browser; production auth/D1/cross-device sessions; live dictionary availability; WebMCP in a supported browser.

The development browser rejected the loopback preview with net::ERR_BLOCKED_BY_CLIENT. No alternate network route was used to bypass that restriction. Build and backend tests do not replace browser acceptance testing.

No production deployment was performed. CI, if enabled, runs build/type/backend checks only and does not deploy.
