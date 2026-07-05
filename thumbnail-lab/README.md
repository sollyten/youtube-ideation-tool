# Thumbnail Lab (ISOLATED MODULE)

This module is deliberately walled off from the rest of the software.

## Isolation contract (read first)
The Thumbnail Lab must **only** use:
- the Higgsfield API / MCP connection, and
- this module's own per-channel visual style store (`styles/<slug>.json`) and reference
  images (`references/<slug>/`).

It must **NOT** load, import, or receive:
- any Claude skill (content-bucket-2-writer, kling-prompt-writer, etc.),
- the project's CLAUDE.md, personality, or memory files,
- the strategic channel profile (`profiles/<slug>.json`) with its competitors,
  audience psychographics, focus statements, or performance data.

The only channel information that crosses into this module is **visual**: a short style
descriptor plus reference thumbnails the user explicitly uploads here. Nothing about
scripting, strategy, or the user's proprietary methodology enters this module. If you
are implementing this and find yourself reaching for the main profile or a skill, stop:
that is the boundary this module exists to enforce.

Practical implementation: run this as its own service / its own Claude context with
ONLY the Higgsfield connector attached. In the web app, the Thumbnail tab calls
Higgsfield directly and reads only this folder.

## What it does
1. **Style capture:** the user uploads reference thumbnails from the channel's previous
   videos. The module stores them and derives a compact visual style descriptor
   (composition, palette, typography, subject treatment, logo placement, mood) into
   `styles/<slug>.json`. This descriptor is reused on every generation so output stays
   on-brand without re-uploading each time.
2. **Generation:** on a user request ("thumbnail for a video about the escape routes out
   of Berlin"), it builds a Higgsfield generation call using the stored style descriptor
   + the request. Model: the configured Higgsfield image model (nano banana Pro).
3. **Reference / edit:** the user can attach an image to the request to either edit it or
   use it as a visual reference for the new generation, via Higgsfield's reference-image
   feature. The attached image and the stored style references are passed to Higgsfield
   together.

## Files
```
thumbnail-lab/
  README.md                     this file
  style_profile.schema.json     shape of styles/<slug>.json (visual only)
  thumbnail_request.prompt.md    how to construct a Higgsfield request
  styles/<slug>.json            per-channel visual descriptor (generated)
  references/<slug>/            uploaded reference thumbnails
```

## Higgsfield connection
Connect Higgsfield to THIS module only. Do not attach the other project connectors or
skills to the thumbnail context. Confirm in the module's settings that Higgsfield is the
sole connected tool before generating.

### Transport (implemented)
The backend reaches Higgsfield through a small `HiggsfieldClient` interface with two
production transports, selected by `HIGGSFIELD_ADAPTER`:
- `http` — Higgsfield REST API using the company `HIGGSFIELD_API_KEY`.
- `mcp` — a **Higgsfield MCP server** (`HIGGSFIELD_MCP_URL`, Streamable HTTP). The client
  connects, lists tools, and calls the configured image-generation tool; tool and
  argument names are env-configurable so they can be matched to the real server's schema
  without code changes. To connect a real Higgsfield MCP server: set
  `HIGGSFIELD_ADAPTER=mcp` and `HIGGSFIELD_MCP_URL` (+ token/tool/arg overrides as needed).

Both transports live entirely inside `server/src/thumbnail/` and import nothing from the
strategic side — an automated test (`test/thumbnailIsolation.test.ts`) fails the build if
that ever changes.
