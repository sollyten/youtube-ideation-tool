---
description: Generate ranked, de-duplicated video ideas for a channel
---

Argument: $ARGUMENTS = profile slug. Follow SPEC.md SS3 exactly.

1. Load profiles/<slug>.json (if missing, list profiles, offer /build-profile).
2. Refresh the channel + run `scripts/outlier_detect.py` on it.
3. For each competitor: fetch + `outlier_detect.py`. Collect competitor outliers.
4. Fill `prompts/01_idea_generation.perplexity.md` (profile + both outlier lists +
   recent_topics + memory/<slug>_ideas.jsonl as the do-not-repeat list). idea_count =
   50-100. Run via `scripts/perplexity_research.py`.
5. Run `scripts/dedupe.py memory/<slug>_ideas.jsonl <candidates.json>` to drop repeats.
6. Fill `prompts/02_idea_scoring.opus.md` with the unique candidates + full profile +
   memory. Reason step by step, score each 0-100, select top 15.
7. Append the 15 selected to memory/<slug>_ideas.jsonl.
8. Save to output/<slug>/ideas_<datetime>.{json,md}. Print top 3 + file path.
