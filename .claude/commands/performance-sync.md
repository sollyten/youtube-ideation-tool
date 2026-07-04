---
description: Sync owned-channel performance and refresh durable learnings (learning loop)
---
Arg: $ARGUMENTS = slug. Follow SPEC.md SS4b. LOCKED until this profile has authorized.

1. Check profiles/<slug>.json connections.youtube_analytics.connected. If false, tell the
   user to connect this channel's YouTube authorization first; stop.
2. `scripts/fetch_analytics.py <slug> --recent 10`. Compute the Studio-style "N of 10"
   rank. Append records to performance/<slug>.jsonl, preserving each video's originating
   idea alignment_score where known.
3. Fill `prompts/06_performance_learnings.opus.md` with the performance rows + any
   retention findings + existing learnings. Produce calibration notes + merged learnings.
4. Write learnings back into profiles/<slug>.json (learnings[]). Save a snapshot to
   output/<slug>/performance_<datetime>.{json,md}.
