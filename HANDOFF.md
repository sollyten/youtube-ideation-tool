# Phase 1 handoff — how this codebase is structured and how to extend it

Phase 1 (the multi-user spine + the Idea Generation slice) is complete. This
document is the map for whoever builds Phase 2 (competitor analysis,
recombination, Performance Tracker + per-user OAuth, Retention Lab) and Phase 3
(Thumbnail Lab, History tab, admin usage UI, polish). Follow the existing
patterns — every hard problem already has one worked example.

## Running it

```bash
npm install
cp .env.example .env            # fill in company keys + secrets
createdb creatortool            # any Postgres 14+
npm run migrate                 # applies server/src/db/migrations/*.sql
npm run dev                     # server :3000 + vite :5173 (proxies /api)
```

- Tests: `npm test` (needs a `creatortool_test` database; external services are
  stubbed, no keys required).
- Demo data without keys: `npx tsx server/src/dev/seed.ts` → sign in as
  `demo@telos.so` / `password123`.
- The first registered account becomes the admin.

## The spine (do not work around these)

| Concern | Where | Rule |
|---|---|---|
| Identity | `server/src/auth/middleware.ts` | `getCurrentUser()` is the only identity read. Routes get `scoped(req)` from `requireAuth`. Never parse cookies or sessions anywhere else. |
| Data access | `server/src/data/scoped.ts` | ALL persistence goes through `ScopedData`. Every method filters by `owner_user_id`; cross-user reads are only possible via `visibility='company'` (read-only). New tables: add the `owner_user_id` column, add methods here, never query from routes. |
| Company keys | `server/src/credentials/companyCredentials.ts` | The only reader of key env vars. Ask it for exactly the key you need; never forward `process.env` wholesale (see how `services/scripts.ts` injects per-script keys). |
| Token crypto | `server/src/credentials/tokenCrypto.ts` | AES-256-GCM for per-user OAuth tokens. `ScopedData.saveChannelToken/getChannelToken` already wrap it — Phase 2's OAuth flow should only ever touch tokens through those two methods. |
| Prompt templates | `server/src/prompts/templateEngine.ts` | Renders any file in `prompts/`. Build a context object, call `renderPromptFile(dir, name, ctx)`. It throws on unresolved placeholders — that is intentional; pass `""` explicitly for optional sections. |
| Reasoning | `server/src/reasoning/adapter.ts` | All Opus steps (prompts 02/04/05/06) go through `getReasoningAdapter().complete()`. Company API key path only. Tests use `StubReasoningAdapter` via `setReasoningAdapter()`. |
| Scripts | `server/src/services/scripts.ts` | Deterministic work (fetching, outliers, dedupe) shells out to `scripts/*.py`. Tests swap implementations with `setScriptRunner()`. |
| Quotas | `server/src/services/quota.ts` | Call `assertQuota(scoped, action)` before any expensive run and `scoped.recordUsage(...)` after. Add new actions to `MeteredAction` + env-config in `config/env.ts`. |
| Errors | `server/src/errors.ts` | Throw the typed errors; the app-level handler maps them. Upstream failures use `UpstreamError` — never swallow a fetch failure or fabricate data. |

## How to build a Phase 2 feature (recipe)

`services/ideation.ts` is the reference pipeline. For e.g. Deep Competitor
Analysis (SPEC §4):

1. Add a service `services/competitorAnalysis.ts`: quota check → script fetches
   → `renderPromptFile("03_competitor_deep_analysis.perplexity", ctx)` →
   `perplexityResearch` → parse with `services/json.ts` → save via
   `scoped.createReport(profileId, "competitor", payload)` → `recordUsage`.
2. The "Generate ideas from these outliers" CTA feeds `topic_bank`/`format_bank`
   into prompt 04 through the reasoning adapter, then reuses the ideation
   tail (dedupe → memory append → report) — extract those steps from
   `ideation.ts` into shared helpers when you get there.
3. Route: one thin handler in `routes/`, mounted behind `requireAuth` in
   `app.ts`. Validation with zod at the edge.
4. UI: add a page under `web/src/pages/`, API methods in `web/src/api.ts`.
   Reuse the card/pill/subscore primitives in `styles.css`.

### Performance Tracker specifics (security-critical)

- Google OAuth callback exchanges the code server-side, then stores tokens ONLY
  via `scoped.saveChannelToken(profileId, tokenJson, channelId)` (encrypted).
- To call `scripts/fetch_analytics.py`, decrypt via `scoped.getChannelToken`,
  write the token to a per-run temp dir (`mkdtemp`), pass it as the script's
  user-scoped `token_dir`, and wipe the dir in a `finally`. Never a shared path,
  never persisted plaintext — the script's docstring describes this contract.
- The tab stays locked until `connections.youtube_analytics.connected` is true
  for that profile; only the connecting owner can trigger analytics.

### Thumbnail Lab (Phase 3, isolated by contract)

Must live in its own module that imports ONLY the Higgsfield key (via
`getCompanyKey("higgsfield")`) and its own per-user visual store. It must not
import `ScopedData` profile methods, memory, or prompts outside
`thumbnail-lab/`. Give it its own narrow data table + accessor if needed.

## What exists today

- Auth (register/login/logout/me), roles, first-user-admin bootstrap.
- Profiles: preview (fetch + AI auto-fill) → confirm → save; inline focus edit;
  per-user slugs; company visibility (admin-gated).
- Ideation end to end: outliers → Perplexity (prompt 01) → dedupe.py → Opus
  scoring (prompt 02) → idea memory → saved report; per-user daily quotas;
  usage events; admin endpoints `/api/admin/credentials` + `/api/admin/usage`.
- Web UI: login, channels, add-channel wizard, profile page, idea-run report,
  light/dark theme.
- 25 tests covering isolation (403/404), auth, quotas, crypto, the template
  engine, and the full pipeline with stubbed externals.

## Environment

See `.env.example`. Required to boot: `DATABASE_URL`, `AUTH_SECRET`,
`TOKEN_ENCRYPTION_KEY`. Company keys (`YOUTUBE_API_KEY`, `PERPLEXITY_API_KEY`,
`ANTHROPIC_API_KEY`, `HIGGSFIELD_API_KEY`) are needed only for the features
that use them; missing keys fail loudly with a per-service message.
