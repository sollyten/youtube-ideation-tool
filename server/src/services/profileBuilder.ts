/**
 * Profile setup (SPEC §2, "Add Channel"). Collects the USER fields, fetches
 * channel facts deterministically, has the reasoning model fill the AUTO
 * fields, and returns the assembled profile for confirmation BEFORE anything
 * is written.
 */
import { getScriptRunner, type ChannelData } from "./scripts.js";
import { getReasoningAdapter } from "../reasoning/adapter.js";
import { extractJsonObject } from "./json.js";
import { UpstreamError } from "../errors.js";
import { randomUUID } from "node:crypto";

export interface ProfileBuildInput {
  channel_url: string;
  focus_statement: string;
  user_style_description: string;
  resources: Array<{ label: string; type: "pasted_text" | "uploaded_file"; content: string }>;
  competitors: Array<{ url: string }>;
  audience: { age_ranges: string[]; top_countries: string[] };
}

export interface ProfilePreview {
  slug: string;
  data: Record<string, unknown>;
  warnings: string[];
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "channel";
}

interface AutoFields {
  niche: string;
  format_style: string;
  tone: string;
  house_style_notes: string;
  recent_topics: string[];
}

/** Median of mature-ish view counts, used as the stats.median_views baseline. */
function medianViews(channel: ChannelData): number {
  const counts = channel.recent_videos.map((v) => v.view_count).sort((a, b) => a - b);
  if (counts.length === 0) return 0;
  const mid = Math.floor(counts.length / 2);
  return counts.length % 2 ? counts[mid] : Math.round((counts[mid - 1] + counts[mid]) / 2);
}

async function inferAutoFields(
  channel: ChannelData,
  input: ProfileBuildInput,
): Promise<AutoFields> {
  const titles = channel.recent_videos.map((v) => v.title);
  const response = await getReasoningAdapter().complete({
    system:
      "You are a YouTube channel analyst. You derive a channel's strategic profile " +
      "from its real video titles and the creator's own words. Never invent facts; " +
      "when the titles are ambiguous, describe what is actually there. The creator's " +
      "own description outranks your inference wherever they conflict.",
    user: [
      `Channel: ${channel.channel_title}`,
      `Subscribers: ${channel.subscriber_count} | Total views: ${channel.view_count} | Videos: ${channel.video_count}`,
      "",
      "Creator's near-term focus (weight heavily):",
      input.focus_statement,
      "",
      "Creator's own style description (ground truth):",
      input.user_style_description,
      "",
      `Last ${titles.length} video titles:`,
      ...titles.map((t) => `- ${t}`),
      "",
      "Return ONLY a JSON object with exactly these keys:",
      `{
  "niche": "specific not generic, one line",
  "format_style": "e.g. 'obstacle-based narrative, present tense, ~20min'",
  "tone": "one line",
  "house_style_notes": "distinctive rules worth remembering, 2-4 sentences",
  "recent_topics": ["condensed topic per recent video, used for de-duplication"]
}`,
    ].join("\n"),
    maxTokens: 4000,
  });
  const parsed = extractJsonObject<AutoFields>(response, "profile auto-fill");
  if (!parsed.niche || !Array.isArray(parsed.recent_topics)) {
    throw new UpstreamError("Profile auto-fill returned an incomplete result");
  }
  return parsed;
}

export async function buildProfilePreview(input: ProfileBuildInput): Promise<ProfilePreview> {
  const scripts = getScriptRunner();
  const warnings: string[] = [];

  // 1. Deterministic facts about the channel (fails the whole build if it fails).
  const channel = await scripts.fetchChannelData(input.channel_url);

  // 2. Resolve each competitor to a channel_id. A failed competitor resolution
  //    is surfaced as a warning, not silently dropped or fabricated.
  const competitors = await Promise.all(
    input.competitors.map(async (c) => {
      try {
        const data = await scripts.fetchChannelData(c.url);
        return { name: data.channel_title, url: c.url, channel_id: data.channel_id };
      } catch (err) {
        warnings.push(`Could not resolve competitor "${c.url}": ${(err as Error).message}`);
        return { name: c.url, url: c.url, channel_id: "" };
      }
    }),
  );

  // 3. AI fills the AUTO fields from real titles + the creator's inputs.
  const auto = await inferAutoFields(channel, input);

  const now = new Date().toISOString();
  const slug = slugify(channel.channel_title);
  const data: Record<string, unknown> = {
    slug,
    channel_name: channel.channel_title,
    channel_url: input.channel_url,
    channel_id: channel.channel_id,
    focus: { statement: input.focus_statement, last_updated: now },
    user_style_description: input.user_style_description,
    resources: input.resources.map((r) => ({
      id: randomUUID(),
      label: r.label,
      type: r.type,
      content: r.content,
      added_at: now,
    })),
    competitors,
    audience: input.audience,
    niche: auto.niche,
    format_style: auto.format_style,
    tone: auto.tone,
    house_style_notes: auto.house_style_notes,
    recent_topics: auto.recent_topics,
    connections: {
      youtube_analytics: { connected: false, channel_id: "", token_ref: "", connected_at: "" },
    },
    learnings: [],
    stats: {
      subscriber_count: channel.subscriber_count,
      view_count: channel.view_count,
      video_count: channel.video_count,
      median_views: medianViews(channel),
      snapshot_date: now,
    },
    created_at: now,
    updated_at: now,
  };

  return { slug, data, warnings };
}
