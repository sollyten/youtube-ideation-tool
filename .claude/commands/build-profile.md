---
description: Build/refresh a channel profile via a guided setup wizard
---

Arguments: $ARGUMENTS (first token = channel URL; rest optional).

Run the setup as an interactive wizard, collecting fields in the order defined in
SPEC.md SS2 and writing the shape in profiles/_SCHEMA.json:

1. Parse the channel URL. Run `scripts/fetch_channel_data.py <url>` for stats + last 50
   video titles/view counts.
2. Ask: "What is your catalogue steering toward in the near future?" -> focus.statement.
   Tell the user this is editable later. Weight it heavily in all future ideation.
3. Ask the user to describe the channel's style in their own words -> user_style_description.
4. Offer to accept resources: pasted text or file paths (planned ideas, brand rules,
   banned topics). Store each in resources[] (extract text from any files).
5. Ask for the top competitor channels the audience also watches. Resolve each to a
   channel_id (reuse fetch script's resolver). Store in competitors[].
6. Ask for audience: top 3 age brackets + top countries (from YouTube Studio). Store in
   audience.
7. Infer the AUTO fields (niche, format_style, tone, house_style_notes, recent_topics)
   from the fetched titles + the user's inputs. Snapshot stats incl. median_views.
8. Show the assembled profile for confirmation. If profiles/<slug>.json exists, ask
   overwrite / merge / version. Then write it.
