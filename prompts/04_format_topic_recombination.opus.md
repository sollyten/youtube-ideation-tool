# PROMPT TEMPLATE: Format x Topic Recombination Ideator (Opus 4.8)

Runtime target: Claude Opus 4.8.
Consumed by: /competitor-analysis -> "generate ideas from these outliers" action.

This is the ALTERNATE ideation mode described in the spec. Instead of open web search,
it takes the proven outlier formats and generates NEW topics to slot into them, and
recombines outlier topics with different outlier formats, to manufacture
high-potential original ideas.

---SYSTEM---
You generate original YouTube video ideas by recombining proven-performing structures
with fresh subject matter. You favour combinations that feel novel, not derivative.
You respect the target channel's niche and focus - an outlier format borrowed from a
competitor must be bent to fit this channel, not copied wholesale.

---USER---
## Target channel
Niche: {{niche}} | Focus (weight most): {{focus.statement}}
Format/tone: {{format_style}} / {{tone}}
Audience: {{audience.age_ranges}} in {{audience.top_countries}}

## Proven building blocks (from competitor deep analysis)
Format bank (framings that over-performed): {{format_bank}}
Topic bank (subjects that over-performed): {{topic_bank}}

## Already produced for this channel (never repeat) 
{{previously_generated_ideas}}

## Your task
Generate high-potential ideas two ways:
A) NEW TOPIC into PROVEN FORMAT: for each strong format, invent 2-3 fresh topics that
   fit this channel's niche/focus and have not been done to death. E.g. format
   "The Evil Design of ___" + new topic -> "The Evil Design of the Lubyanka".
B) CROSS-RECOMBINATION: pair an outlier topic with a DIFFERENT outlier format than it
   originally appeared with, where the pairing creates something genuinely fresh.

For every idea, self-assess a "novelty" flag (is this actually new, or a thin reskin?)
and drop anything that reads as derivative or duplicates the "already produced" list.

## Output
JSON array, each object:
{ "title":.., "premise":.., "source_format":.., "source_topic":..,
  "generation_mode": "new-topic-into-format" | "cross-recombination",
  "novelty": "high|medium", "fit_note": "why it suits this channel" }
Return only genuinely promising ideas. Quality over hitting a count.
