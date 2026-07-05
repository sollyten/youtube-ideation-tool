# Handoff — how this codebase is structured and how to extend it

Phases 1–3 are implemented. This document is the map of the patterns; follow
them for any further work — every hard problem already has one worked example.

**Status:** Phase 1 (multi-user spine + Idea Generation), Phase 2 (Deep
Competitor Analysis + recombination, Performance Tracker + per-user encrypted
OAuth, Retention Lab), and Phase 3 (isolated Thumbnail Lab, History tab, admin
usage view) are all built, wired into the UI, and covered by 35 tests.

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
  per-user slugs; company visibility (admin-gated). The **Details tab** edits
  resources (paste text or upload pdf/docx/txt — text extracted server-side via
  `services/extractText.ts`) and competitors (add-by-URL resolves the
  channel_id) and audience, all removable in-UI (SPEC §2 Req #3/#4).
- **Ideation** end to end: outliers → Perplexity (prompt 01) → dedupe.py → Opus
  scoring (prompt 02) → idea memory → saved report. The scoring tail lives in
  `services/ideaScoring.ts` and is shared with recombination.
- **Deep Competitor Analysis** (`services/competitorAnalysis.ts`): competitor
  outliers with real video URLs → prompt 03 (Perplexity deep research) →
  breakdowns + topic_bank + format_bank → "competitor" report. The "Generate
  ideas from these outliers" CTA runs prompt 04 (Opus) → the shared scoring tail.
- **Performance Tracker** (`services/performance.ts`, `oauth/youtube.ts`):
  per-director Google OAuth (server-side code exchange, signed state, token
  stored encrypted via `saveChannelToken`), locked until connected;
  fetch_analytics.py run with a per-run temp token dir (wiped after); Studio "N
  of 10" ranks; pre-production alignment_score matched back by title; prompt 06
  distils learnings written back into the profile (the compounding loop).
- **Retention Lab** (`services/retentionLab.ts`): API path (fetch_analytics
  --retention) or image path (vision through the reasoning adapter), prompt 05
  with `knowledge/retention_analysis.md` as authority; next_video_rules saved
  and read by the performance loop.
- **Thumbnail Lab** (`src/thumbnail/*`): ISOLATED — own tables, Higgsfield-only
  client, deterministic prompt composition (no reasoning model / profile /
  memory). A static test (`test/thumbnailIsolation.test.ts`) fails the build if
  the module ever imports the strategic side.
- **History** tab (all reports, filter by channel + type) and **admin** usage +
  credential-status views. Per-user daily quotas on every expensive action.
- Web UI: login, channels, add-channel wizard, profile page with a tab per
  feature, report views for every type, light/dark theme.
- 40 tests: isolation (403/404), auth, quotas, crypto, template engine, the
  full ideation/competitor/recombination/performance/retention pipelines, the
  Thumbnail Lab isolation contract, and text extraction — all with stubbed
  externals.

## The reasoning + Higgsfield adapters (test seams)

- `getReasoningAdapter()` / `setReasoningAdapter()` — company Anthropic key path
  (`claude-opus-4-8`, adaptive thinking, streaming, optional vision images).
  Tests inject `StubReasoningAdapter` and `enqueue()` responses.
- `getScriptRunner()` / `setScriptRunner()` — swap any Python script call. Its
  `perplexityResearch(prompt, mode)` routes to `services/perplexity.ts`: mode
  `{api:"sonar", model}` (Idea Generation, prompt 01 — model selectable per run:
  sonar-pro | sonar-deep-research) or `{api:"agent"}` (Deep Competitor Analysis,
  prompt 03 — Perplexity Agent API). `setPerplexityFetch()` injects fetch for
  tests. Endpoint/model/timeout are env-configurable (see `.env.example`).
- `getHiggsfieldClient()` / `setHiggsfieldClient()` — Thumbnail Lab only.
  `HIGGSFIELD_ADAPTER` picks the transport: `http` (REST + `HIGGSFIELD_API_KEY`),
  `mcp` (a Higgsfield MCP server — `HIGGSFIELD_MCP_URL` + configurable tool/arg
  names, see `.env.example`), or `stub`. The MCP client (`higgsfieldMcp.ts`)
  uses the official `@modelcontextprotocol/sdk` and is proven end-to-end against
  an in-memory mock MCP server in `test/higgsfieldMcp.test.ts`. Both transports
  stay inside `src/thumbnail/` — the isolation test guards that.
- Tests run in a single fork (see `vitest.config.ts`) because they share one
  Postgres test DB and TRUNCATE between cases.

## Environment

See `.env.example`. Required to boot: `DATABASE_URL`, `AUTH_SECRET`,
`TOKEN_ENCRYPTION_KEY`. Company keys (`YOUTUBE_API_KEY`, `PERPLEXITY_API_KEY`,
`ANTHROPIC_API_KEY`, `HIGGSFIELD_API_KEY`) are needed only for the features
that use them; missing keys fail loudly with a per-service message.
