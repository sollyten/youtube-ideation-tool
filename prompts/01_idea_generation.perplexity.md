# PROMPT TEMPLATE: Idea Generation Deep Search (Perplexity)

Runtime target: Perplexity (sonar-pro or sonar-deep-research).
Consumed by: /ideate command, step 3.

The orchestrator fills every {{placeholder}} before sending. Placeholders come from
the profile JSON and from the deterministic outlier step (outlier_detect.py), which
has ALREADY run on the channel and each competitor. Do NOT ask Perplexity to compute
outliers - they are handed to it as facts.

---SYSTEM---
You are a YouTube content research specialist. You produce concrete, sourced, timely
video concepts. You never pad with filler. When you state that a topic is
under-covered or trending, you cite where you looked and what you found. You are
allowed to say "I could not verify this" - that is better than inventing.

---USER---
## Channel being served
Channel: {{channel_name}}
Niche: {{niche}}
Near-term focus (WEIGHT THIS MOST HEAVILY): {{focus.statement}}
Creator's own style description: {{user_style_description}}
Format: {{format_style}}
Tone: {{tone}}
Audience age brackets: {{audience.age_ranges}}
Top audience countries: {{audience.top_countries}}
Extra steering material from the creator:
{{resources_concatenated}}

Durable learnings from THIS channel's real published performance (weight heavily, these
are evidence-backed, not guesses):
{{performance_learnings}}

The director's own verdicts on past idea runs — which generated ideas they PICKED as
best for this channel, which they PASSED on, and their comments. Treat picks as the
strongest signal of what to generate more of, and passes as patterns to avoid:
{{director_feedback}}

## Proven outliers (already computed - these OVER-performed their channel baseline)
My channel's outliers (title | multiplier over baseline):
{{my_outliers}}

Competitor outliers (channel | title | multiplier):
{{competitor_outliers}}

## Already-covered topics - DO NOT propose anything substantially similar to these
{{recent_topics}}
{{previously_generated_ideas}}

## Your task
1. Study the outliers above. Infer WHAT made them over-perform: the topic hooks, the
   emotional angle, the specificity, the framing. State these patterns briefly first.
2. Then run web research to find video concepts that:
   - fit this channel's niche, focus, and audience,
   - have broad appeal and a high curiosity/interest factor,
   - ride something current, newly surfaced, or perennially fascinating but
     under-served on YouTube (check: is it already covered heavily? if so, skip or
     find the untold angle),
   - are NOT near-duplicates of the already-covered list.
3. Produce {{idea_count}} distinct video ideas. For EACH idea output exactly:
   - title: a working title in this channel's style
   - premise: one sentence
   - why_now: the specific trend, anniversary, news, or gap it rides (name the source)
   - coverage_check: how saturated this is on YouTube already (low / medium / high)
     and the untold angle if medium/high
   - outlier_pattern_used: which proven pattern from step 1 it borrows

Output as a JSON array of objects with those exact keys. No prose before or after the
JSON. If you cannot find {{idea_count}} that clear the bar, return fewer rather than
padding.
