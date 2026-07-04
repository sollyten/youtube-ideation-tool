# YouTube Ideation & Competitor Intelligence

A HOSTED, MULTI-USER internal creator tool for a company's directors. Each director logs
in and manages their own channels: generate video ideas, run deep competitor analysis,
track published performance, analyze retention second by second, and generate on-brand
thumbnails. It LEARNS from real results over time, per channel. All usage runs on
COMPANY-provisioned API keys (server-side).

**Start here:** `SPEC.md` (full build spec) and `profiles/_SCHEMA.json` (profile shape).

## Tabs / features
1. **Idea Generation** - deterministic 3x outlier detection -> Perplexity researches
   50-100 timely, under-served ideas -> Opus scores them against your profile, returns
   the best 15 with alignment %. Never repeats.
2. **Deep Competitor Analysis** - Perplexity deep-research on competitor outliers:
   thumbnail design, Topic/Format split ("The Evil Design of Auschwitz" -> topic:
   Auschwitz / format: "The Evil Design of ___"), transcript-based "why it worked", plus
   a recombination ideator (new topics into proven formats).
3. **Performance Tracker** - locked per channel until that channel authorizes its OWN
   YouTube analytics. Studio-style recent-video list with an "N of 10" rank, logs results,
   and closes the LEARNING LOOP: real outcomes become durable learnings that feed future
   ideation and scripting, and calibrate the scoring model.
4. **Retention Lab** - second-by-second analysis from the Analytics API or an uploaded
   graph screenshot, reasoning from the in-house retention framework in
   `knowledge/retention_analysis.md`.
5. **Thumbnail Lab** - ISOLATED Higgsfield-only module. Stores your reference thumbnails,
   locks in your visual style, generates with nano banana Pro, supports attach-to-edit /
   attach-as-reference. Sees none of your skills, memory, or strategy. See
   `thumbnail-lab/README.md`.

## The learning cycle
idea -> alignment score -> publish -> measure performance + retention -> distil learnings
-> better next idea. Each channel's data stays in its own profile and never mixes.

## Setup (hosted)
Server-side company keys in `.env` (see `.env.example`): YouTube Data API, Perplexity,
Anthropic (reasoning), Higgsfield. Plus auth secret, Postgres `DATABASE_URL`, a
`TOKEN_ENCRYPTION_KEY`, and a Google OAuth client so directors can connect their own
channels. Directors log in; each connects their own channels for the Performance Tracker.

## Commands
```
/build-profile <url> ...        guided channel setup
/ideate <slug>                  generate + score 15 ideas
/competitor-analysis <slug>     deep competitor report + recombination
/performance-sync <slug>        sync analytics + refresh learnings (learning loop)
/retention-lab <slug> --video <id> | --image <path>
```

## Layout
```
CLAUDE.md  SPEC.md  README.md
profiles/    _SCHEMA.json + generated profiles
prompts/     01-06 runtime templates (Perplexity + Opus)
scripts/     fetch_channel_data, fetch_analytics, outlier_detect, dedupe, perplexity
knowledge/   retention_analysis.md (authoritative retention framework)
memory/      per-channel idea memory (no-repeat)
performance/ per-channel performance + retention logs
output/      saved reports (History tab reads this)
connections/ per-profile OAuth tokens (git-ignored)
thumbnail-lab/  ISOLATED Higgsfield-only thumbnail module
```

## Cost
Everything runs on company keys and bills to the company: Perplexity per research call,
Anthropic per reasoning call (prompts 02/04/05/06), Higgsfield per thumbnail; YouTube APIs
are effectively free within quota. There is no personal-subscription mode in the hosted
product. Add per-user quotas and an admin usage view (SPEC.md SS8).
