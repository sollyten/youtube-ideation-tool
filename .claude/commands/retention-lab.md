---
description: Second-by-second retention analysis of an owned video
---
Args: $ARGUMENTS = "<slug> --video <id>" OR "<slug> --image <path>". Follow SPEC.md SS4c.

1. Load profiles/<slug>.json.
2. Get retention input:
   - API path: `scripts/fetch_analytics.py <slug> --video <id> --retention`.
   - Image path: read the uploaded retention screenshot (vision).
3. Fill `prompts/05_retention_lab.opus.md`, injecting the FULL text of
   `knowledge/retention_analysis.md` as the authoritative framework. Analyze.
4. Save report to output/<slug>/retention_<datetime>.{json,md}. Append the
   next_video_rules to performance/<slug>_retention.jsonl (feeds the learning loop).
