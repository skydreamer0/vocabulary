# English Vocabulary

A desktop-first English vocabulary PWA with a real Worker API and D1 database.
以電腦操作為主的英文詞彙 PWA，包含真正的後端 API 與持久化資料庫。

## Status / 目前狀態

Working MVP source, migrations and backend integration tests. **No production website or database has been deployed.** Uploading this repository does not provision D1 or configure production authentication. Actual browser desktop/mobile QA remains pending because the development browser blocked loopback preview.

目前交付程式碼與測試，尚未部署正式網站或資料庫。編譯及後端測試通過，不代表實際瀏覽器視覺驗收已通過。

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

Node.js 22.13+ (CI uses Node 24).

```sh
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_complex_outlaw_kid.sql
npm run dev
```

Apply the initial migration once for a fresh local database. Open the loopback URL printed by the server. Local development supports `/signin-with-chatgpt?return_to=/` with a synthetic test user; that mock helper is excluded from production. Saved data lives in local D1 under ignored `.wrangler/state`. Capture drafts are device-local and user-keyed.

```sh
npm run typecheck
npm run test:api
```

Tests build and execute the real Worker with Miniflare and D1/SQLite. Dictionary responses are mocked for repeatability. See [QA.md](QA.md).

## Deployment and identity: read before hosting

`npm run build` emits Cloudflare Workers-compatible output. Production requires a real D1 database bound as `DB` and the generated migrations in `drizzle/`.

**Current authentication depends on OpenAI Sites dispatch.** `app/chatgpt-auth.ts` trusts platform-injected `oai-authenticated-user-id` and `oai-authenticated-user-email` headers. `/signin-with-chatgpt`, `/signout-with-chatgpt` and `/callback` are platform-owned routes, not implemented here.

The logical `.openai/hosting.json` deliberately contains no private Site identity or credentials. For Sites hosting, use its supported registration/deployment workflow to configure owner-private access, provision D1 and apply migrations.

**Do not deploy this app publicly as a standalone Worker unchanged.** First replace the auth adapter with server-verified authentication, implement that provider's login flow, and ensure caller-supplied identity headers cannot be trusted. Merely putting a proxy in front without validating its identity token is not a complete auth adaptation. No standalone adapter, provider account or production database has been configured.

目前登入依賴 Sites 驗證層。若改用自己的 Cloudflare 網域，必須先接上伺服器端驗證的登入機制；不能直接相信瀏覽器傳入的使用者標頭。

No paid dictionary API/key is required. Hosting costs and provider limits depend on the deployment selected; no paid plan is configured.

## Data and limits

- Saved words/history use D1, never localStorage
- Only capture drafts are device-local; offline mutations are not queued
- Service worker caches no private API data, only the offline screen and icons
- 20,000-character capture, 80 KB TXT, 100 records/import; field sizes and request rates are bounded
- History UI/export shows the newest 300 events; all review events remain in D1
- Review intervals: Again 10 minutes; Hard at least 1 day; Good 1 day initially then at least 3; Easy at least 3; later intervals grow and cap at 365 days
- This is a simple interval heuristic, not a validated learning optimization claim
- Installation and speech depend on browser/OS support; the offline screen is not full offline learning

## API

`GET/POST/PATCH /api/words`, `GET/POST /api/reviews`, `POST /api/lookup`.
Every route requires verified platform identity. Writes use validation, owner scoping and same-origin checks. Dictionary fetches use one fixed HTTPS destination, timeout and response-size bound; redirects are not followed.
