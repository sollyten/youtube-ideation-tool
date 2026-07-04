---
description: Deep competitor analysis report (outliers, thumbnails, topic/format, transcripts)
---

Argument: $ARGUMENTS = profile slug. Follow SPEC.md SS4.

1. Load profiles/<slug>.json.
2. For each competitor: fetch + `scripts/outlier_detect.py`. Collect outliers WITH URLs.
3. Fill `prompts/03_competitor_deep_analysis.perplexity.md` and run via Perplexity deep
   research. Get: per-outlier thumbnail description, topic/format split, transcript-based
   "why it over-performed", plus topic_bank + format_bank.
4. Save a clean report to output/<slug>/competitor_<datetime>.{json,md} (presentation
   rules: SPEC.md SS6). Print a summary.
5. Ask the user: generate ideas from these outliers? If yes, fill
   `prompts/04_format_topic_recombination.opus.md` with topic_bank + format_bank +
   memory, generate + score + dedupe + save like an /ideate run.
