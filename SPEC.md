# YouTube Ideation & Competitor Intelligence - Build Spec

This document is written to be coded from directly by an AI (Fable 5). It defines a
HOSTED, MULTI-USER internal company tool: multiple directors log in and each manage
their own channels. It runs entirely on COMPANY-provisioned API keys (server-side); no
user brings their own key. Two headline features (Idea Generation, Deep Competitor
Analysis) plus Performance Tracker, Retention Lab, Thumbnail Lab, and a History tab.

## 0. Architecture at a glance

```
   Directors (browser) --> AUTH --> per-user session
                    +------------------- HOSTED WEB APP (multi-user) ------------+
                    |  UI: Profiles | Ideate | Competitor | Performance |         |
                    |      Retention | Thumbnail | History     (scoped per user)  |
                    +----------------------------+-------------------------------+
                                                 | (every request carries userId)
                    +----------------------------v-------------------------------+
                    |            ORCHESTRATOR (backend, server-side)              |
                    |  auth guard -> user-scoped data layer -> runs scripts,      |
                    |  fills prompt templates, sequences AI calls                 |
                    +--+-----------------+------------------+----------+----------+
                       |                 |                  |          |
             deterministic       Perplexity API     Anthropic API   Higgsfield
             Python scripts      (COMPANY key)      (COMPANY key)   (COMPANY key,
             (facts, no AI)                         reasoning       thumbnail-lab
                                                    steps           only)
```

Two design rules:
- **Determinism first:** anything arithmetic or data-fetching is a deterministic script;
  only genuine judgement goes to an AI. Outlier detection, baselines, de-duplication are
  code, not prompts.
- **Isolation first:** every record, file, and token is scoped to the owning user.
  Directors never see each other's profiles, ideas, reports, or channel tokens unless a
  profile is explicitly shared (see SS1). Enforce this at the data layer, not just the UI.

## 1. Data model (multi-user)

Use a real database (Postgres recommended), NOT flat files, because this is concurrent
and multi-user. The jsonl/JSON shapes in the repo describe the RECORD CONTENT; store
them as rows/documents keyed by owner.

Core tables/collections:
- `users` (id, email, name, role: director | admin, created_at).
- `profiles` (id, owner_user_id, slug, ...the `_SCHEMA.json` fields..., visibility:
  private | company). `slug` is unique PER USER, not globally.
- `idea_memory` (owner_user_id, profile_id, idea record) - the no-repeat store.
- `reports` (owner_user_id, profile_id, type: ideas|competitor|retention|performance,
  created_at, payload) - the History tab queries this, filtered to the current user.
- `channel_tokens` (owner_user_id, profile_id, ENCRYPTED YouTube OAuth token) - see SS10.

Every query is filtered by `getCurrentUser()`; there is no un-scoped read. A director
requesting a profile they do not own (and that is not `company`-visible) gets 403.
Large report payloads may be stored as files in per-user object storage
(`storage/<userId>/reports/...`) with a DB row pointing to them; if so, that path is
also user-scoped and access-checked.

## 2. Feature: Profile setup (`/build-profile` or UI "Add Channel")

On first add of a channel, collect in this order:
1. Channel URL -> resolve + fetch stats/titles (`fetch_channel_data.py`).
2. **Near-term focus** (Req #1): free-text "What is your catalogue steering toward in
   the near future?" Stored in `focus.statement`. **Must be editable in the UI later**
   via an inline edit on the profile page - focus changes often.
3. **Creator's own style description** (Req #2): free-text, stored verbatim in
   `user_style_description`. Weighted above AI inference everywhere it's used.
4. **Resources** (Req #3): a panel to paste text or upload files (planned ideas, brand
   rules, banned topics). Each becomes a `resources[]` entry. Editable/removable in UI.
   Uploaded files: extract text (pdf/docx/txt) and store the text in `content`.
5. **Competitors** (Req #4): paste the channels the audience also watches. On save,
   resolve each to a `channel_id`. Editable in UI. Used by BOTH features.
6. **Audience** (Req #5): the top-3 age brackets and top countries from YouTube Studio
   > Audience. Stored in `audience`.
Then the AI fills the AUTO fields (niche, format_style, tone, house_style_notes,
recent_topics, stats) and the profile is saved. Show it for confirmation before write.

## 3. Feature: Idea Generation (`/ideate <slug>` or UI "Generate Ideas")

Pipeline (orchestrator sequences this):

1. Refresh channel data + run `outlier_detect.py` on the selected channel.
2. For each competitor: fetch data + run `outlier_detect.py`. Collect competitor
   outliers (title | multiplier | channel).
   - vidIQ note: not required. Outliers come from YouTube Data API view counts, which
     we already fetch. If you later want vidIQ's "outlier score", that needs vidIQ's
     own API/subscription; treat as an optional future enrichment, not a dependency.
3. Fill `prompts/01_idea_generation.perplexity.md` with the profile + both outlier
   lists + the de-dup lists (`recent_topics` and the memory file). Send to Perplexity.
   Ask for {{idea_count}} = 50-100 raw ideas.
4. Fill `prompts/02_idea_scoring.opus.md` with those raw ideas + full profile + memory.
   Opus reasons step by step, scores each 0-100 against the profile, returns the top 15
   with sub-scores.
5. **Memory / no-repeat (Req):** append every one of the 15 selected ideas to
   `memory/<slug>_ideas.jsonl`. Both prompt 01 and 02 receive the full memory file so
   nothing is ever proposed twice for that channel. De-dup match is fuzzy (normalise
   case/punctuation; flag high title-similarity) - do the fuzzy check in code before
   presenting, as a backstop to the LLM.
6. Save the run to `output/<slug>/ideas_<datetime>.{json,md}` and show in UI + History.

## 4. Feature: Deep Competitor Analysis (UI "Competitor Report")

Triggered by the user for the selected channel. Pipeline:

1. For each competitor in the profile: fetch data + `outlier_detect.py`.
2. Fill `prompts/03_competitor_deep_analysis.perplexity.md` with the competitor
   outliers (including video URLs). Use Perplexity deep-research mode. It returns, per
   outlier: title, thumbnail description, **topic/format split**, a transcript-based
   "why it over-performed" analysis, plus a `topic_bank` and `format_bank`.
3. Render a clean, minimal, modern report (see SS6) into `output/<slug>/competitor_
   <datetime>.{json,md}` and the UI.
4. Offer an action button: **"Generate ideas from these outliers"** -> feeds
   `topic_bank` + `format_bank` into `prompts/04_format_topic_recombination.opus.md`,
   which manufactures original ideas by putting NEW topics into PROVEN formats and by
   cross-pairing topics with different formats. Results also scored/saved/memory-logged
   like a normal ideation run.

## 4b. Feature: Performance Tracker (new tab, per-channel locked)

A tab that stays **LOCKED for each profile until that profile completes its own YouTube
authorization**. Each channel authorizes separately (`connections.youtube_analytics`);
Atrium and MrSpherical never share credentials. See `scripts/fetch_analytics.py` for the
per-profile OAuth model (this is owner-only analytics, distinct from the public API key
used for competitors).

Once unlocked for a profile it:
1. Pulls recent owned-video analytics (views, averageViewPercentage, averageViewDuration,
   CTR, subscribers gained) via `fetch_analytics.py <slug>`.
2. Displays recent videos **in a YouTube-Studio-style list**: each video with a
   performance indicator (we compute a Studio-style "N of 10" rank ourselves from
   averageViewPercentage, since that relative bar is a Studio UI construct, not a raw API
   field) and the key stats beneath.
3. **Logs every published-video record to `performance/<slug>.jsonl`.** Crucially, when a
   video originated from a generated idea, the record keeps that idea's pre-production
   `alignment_score`, so the system can later check whether its own predictions were
   right.

### The learning cycle (why this matters)
This tab feeds `prompts/06_performance_learnings.opus.md`, which distils real outcomes
into durable `learnings` written back to the profile. Those learnings are then injected
as `{{performance_learnings}}` into ideation (prompt 01), recombination (prompt 04), and
the script writer. So: idea -> score -> publish -> measure -> learn -> better next idea.
The loop also reports scoring calibration (do high alignment scores actually predict
strong retention?) and can recommend adjusting the scoring weights in prompt 02.

## 4c. Feature: Retention Lab (new tab)

Second-by-second retention analysis for an owned video. Two input paths:
- **API path:** `fetch_analytics.py <slug> --video <id> --retention` pulls the
  `audienceRetention` report (elapsedVideoTimeRatio + audienceWatchRatio +
  relativeRetentionPerformance). Higher fidelity.
- **Image path:** the user uploads a screenshot of the retention graph; the analyzer
  reads the curve visually (timestamps approximate).

The analyzer (`prompts/05_retention_lab.opus.md`) reasons from
`knowledge/retention_analysis.md` as its PRIMARY authority (the in-house methodology,
already structured for it), supplemented only by high-quality external retention
expertise, never overridden by generic advice. It classifies the overall chart, segments
the curve, names each pattern (spike/dip/sustained/journey type), diagnoses the likely
cause, and emits per-section notes plus a set of `next_video_rules`. Those rules are
logged to `performance/<slug>_retention.jsonl` and feed the same learning loop.

## 4d. Feature: Thumbnail Lab (new tab, ISOLATED module)

Lives in `thumbnail-lab/` and is deliberately walled off. **It may use ONLY the Higgsfield
API/MCP and its own visual style store; it must NOT load any skill, the CLAUDE.md,
personality, memory, or the strategic channel profile.** The only channel data allowed in
is visual: a compact style descriptor plus reference thumbnails the user uploads here.

Capabilities:
1. Upload reference thumbnails from previous videos -> stored in
   `thumbnail-lab/references/<slug>/` and distilled into
   `thumbnail-lab/styles/<slug>.json` (visual descriptor), reused every generation so
   output stays on-brand without re-uploading.
2. Generate from a text request using the stored style + references via Higgsfield, model
   = nano banana Pro.
3. Attach an image to a request to either **edit** it or use it as a **reference** for a
   new thumbnail (Higgsfield reference-image feature).

Implementation note: run the Thumbnail tab as its own context/service with Higgsfield as
the sole connected tool. See `thumbnail-lab/README.md` for the full isolation contract.

## 5. History tab

A single view listing every file under `output/<slug>/` across all channels, newest
first, filterable by channel and by type (ideas | competitor | retention | performance).
Clicking opens the saved report read-only. Nothing is ever overwritten (datetime in
filename). Retention Lab reports and performance snapshots are saved here too, so the
full history of what the system learned about each channel is browsable in one place.

## 6. Report/UI presentation rules

Clean, minimal, modern. For the competitor report specifically: a scannable table of
outliers (title, multiplier, topic, format, thumbnail thumbnail), an expandable "why it
worked" per row, and two chips-lists for the Topic Bank and Format Bank with the
"generate ideas" CTA. Idea reports: ranked cards showing score, sub-score breakdown,
premise, why-now, and format angle. Keep chrome light; let the content breathe.

## 7. Scripts reference (all deterministic, no AI)

- `fetch_channel_data.py <url>` -> public channel stats + last 50 videos w/ view counts
   (API key; works for any channel incl. competitors).
- `fetch_analytics.py <slug> [--recent N] [--video ID --retention]` -> OWNER-only
   analytics via per-profile OAuth (performance + audience retention). Separate creds per
   profile.
- `outlier_detect.py <data.json> [--multiplier 3.0] [--baseline median]
   [--min-age-days 21]` -> baseline + outliers, excluding immature uploads.
- `dedupe.py <memory.jsonl> <candidates.json> [--threshold 0.82]` -> fuzzy no-repeat.
- `perplexity_research.py "<prompt>"` -> Perplexity call, your account.

Knowledge & isolated modules:
- `knowledge/retention_analysis.md` -> authoritative retention framework (Retention Lab).
- `thumbnail-lab/` -> isolated Higgsfield-only thumbnail module (see its README).

Note: the scripts read COMPANY keys from server-side env. `fetch_analytics.py` is called
by the backend with a user-scoped token directory (SS10); it never uses a global token
path in the hosted product.

## 8. Cost model (company-funded)

All API usage runs on COMPANY keys and bills to the company, not to individual directors.
- **Perplexity, YouTube Data API, YouTube Analytics API:** as before; YouTube APIs are
  effectively free within quota, Perplexity bills per research call.
- **Anthropic (reasoning steps: prompts 02, 04, 05, 06):** these run SERVER-SIDE through
  the company `ANTHROPIC_API_KEY`. There is NO subscription/Claude Code mode in the hosted
  product, because a personal subscription cannot be shared across users. Every director's
  run bills to the company Anthropic account.
- **Higgsfield (Thumbnail Lab):** company key, isolated module.

Because usage is now many directors on the company's dime, add lightweight cost controls:
per-user rate limiting / quotas on the expensive actions (ideation, competitor analysis,
retention), and an admin usage view. Keep a reasoning-adapter interface for testability
and future model swaps, but the shipping mode is "company Anthropic API key, server-side".

## 9. Accounts, auth, and secrets (multi-user core)

- **Auth:** every route is behind login. Roles: `director` (manages own channels) and
  `admin` (manages company keys, sees usage, can set a profile `company`-visible). Resolve
  identity through a single `getCurrentUser()`; nothing reads identity directly.
- **Data isolation:** enforced at the data layer. Every read/write is filtered by
  `owner_user_id`. Cross-user access is 403 unless `visibility = company`.
- **Company API keys:** server-side only, never sent to the browser, never per-user.
- **Per-user YouTube OAuth tokens:** each director connects their OWN channels via the
  Google OAuth flow. Tokens are stored ENCRYPTED AT REST (`TOKEN_ENCRYPTION_KEY`), keyed
  by (owner_user_id, profile_id), and decrypted only server-side at call time. A director
  can only ever trigger analytics for their own connected channels. This is
  security-critical: treat a token leak as a channel takeover risk.
- **Thumbnail Lab isolation** still holds, now PER USER: the module sees only Higgsfield
  plus that user's own visual style store, never skills/memory/profile/other users.

## 10. Build order suggestion

Phase 1 (the multi-user spine, hardest, do first):
1. Auth + `users` + `getCurrentUser()` + role guard.
2. User-scoped data layer over Postgres (all access filtered by owner). No un-scoped reads.
3. Server-side company-credentials service + the reasoning adapter (company API key).
4. One full vertical slice end to end: the Idea Generation pipeline (SS3) for the logged-in
   user, proving auth + isolation + scripts + prompt-filling + memory + reasoning + save.
Phase 2: Competitor analysis + recombination; Performance Tracker + per-user encrypted
OAuth; Retention Lab.
Phase 3: Thumbnail Lab (isolated); History tab; full UI polish (light/dark, yellow accents,
micro-interactions); admin usage view + per-user quotas.
The prompt files in `prompts/` are the runtime brains; the orchestration around them is
ordinary code.
