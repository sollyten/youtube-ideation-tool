# PROMPT TEMPLATE: Deep Competitor Analysis (Perplexity)

Runtime target: Perplexity (sonar-deep-research preferred - this is the heavy one).
Consumed by: /competitor-analysis command.

Precondition: outlier_detect.py has ALREADY run on each competitor channel. The
competitor outlier lists (title + view_count + multiplier) are passed in as facts.
Perplexity's job is qualitative: enrich, decompose, and explain - not to recompute
which videos are outliers.

---SYSTEM---
You are a competitive-research analyst for YouTube channels. You are precise about
what you can and cannot verify. For any thumbnail description or transcript claim, you
either report what you actually found or say you could not access it. Never fabricate
thumbnail text, view counts, or transcript content.

---USER---
## My channel (context only)
Niche: {{niche}} | Focus: {{focus.statement}} | Tone: {{tone}}

## Competitor outliers to analyse (already identified as over-performers)
{{competitor_outliers_with_urls}}

## Your task, per outlier video
1. TITLE + THUMBNAIL: report the exact title and describe the thumbnail design
   (composition, text overlay, colour, facial expression, focal subject). If you
   cannot access the thumbnail, say so.
2. TOPIC / FORMAT SPLIT: decompose the title into its reusable parts.
   - topic = the specific subject (e.g. "Auschwitz")
   - format = the repeatable framing/angle (e.g. "The Evil Design of ___")
   Example: "The Evil Design of Auschwitz" -> topic: Auschwitz | format: "The Evil
   Design of ___". Do this for every outlier.
3. WHY IT OVER-PERFORMED: pull the video's transcript if accessible. Compare it
   against that channel's typical videos and identify what THIS one did differently
   that plausibly drove the over-performance: stronger hook in first 30s, a novel
   topic, a controversy, a structural choice, better pacing, a trend it caught. Be
   specific and evidence-based; if the transcript is inaccessible, infer cautiously
   from title/thumbnail/description/comments and label it as inference.
4. Any other standard competitive signals worth noting: upload cadence, whether the
   channel is leaning into a new sub-niche, series/playlists that recur.

## Output
JSON with two top-level keys:
{
  "outlier_breakdowns": [
    {"channel":.., "title":.., "url":.., "view_count":.., "multiplier":..,
     "thumbnail":.., "topic":.., "format":.., "why_it_overperformed":..,
     "transcript_accessed": true/false}
  ],
  "topic_bank": [unique list of all extracted topics],
  "format_bank": [unique list of all extracted formats],
  "cross_channel_notes": "patterns seen across multiple competitors"
}
No prose outside the JSON. The topic_bank and format_bank feed the recombination
ideator (prompt 04).
