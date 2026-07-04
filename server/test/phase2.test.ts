/**
 * Phase 2/3 integration: competitor analysis + recombination, Performance
 * Tracker (lock + sync + learning loop), Retention Lab (image path), and the
 * isolated Thumbnail Lab. Real Postgres; external services stubbed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

process.env.DATABASE_URL = "postgres://creator:creator@127.0.0.1:5432/creatortool_test";
process.env.AUTH_SECRET = "test-secret";
process.env.TOKEN_ENCRYPTION_KEY = "test-token-encryption-key-32chars!";
process.env.REASONING_ADAPTER = "stub";

const { migrate } = await import("../src/db/migrate.js");
const { getPool, closePool } = await import("../src/db/pool.js");
const { createApp } = await import("../src/app.js");
const { setScriptRunner } = await import("../src/services/scripts.js");
const { StubReasoningAdapter, setReasoningAdapter } = await import("../src/reasoning/adapter.js");
const { StubHiggsfieldClient, setHiggsfieldClient } = await import("../src/thumbnail/higgsfield.js");
const { ScopedData } = await import("../src/data/scoped.js");
const { markConnected } = await import("../src/services/performance.js");

let app: Express;
let stubReasoning: InstanceType<typeof StubReasoningAdapter>;
let stubHiggsfield: InstanceType<typeof StubHiggsfieldClient>;

const CHANNEL = {
  channel_title: "Atrium Explores",
  channel_id: "UCmain",
  subscriber_count: 100000,
  view_count: 5000000,
  video_count: 120,
  recent_videos: [
    { video_id: "v1", url: "https://youtu.be/v1", title: "The Lost Submarine", published_at: "2026-01-01T00:00:00Z", view_count: 900000 },
  ],
};
const RIVAL = { ...CHANNEL, channel_title: "Rival Docs", channel_id: "UCrival" };

function stubScripts(overrides = {}) {
  setScriptRunner({
    fetchChannelData: async (url: string) => (url.includes("rival") || url === "UCrival" ? RIVAL : CHANNEL),
    detectOutliers: async (data) => ({
      baseline: 115000,
      baseline_method: "median",
      multiplier_threshold: 3,
      mature_video_count: data.recent_videos.length,
      outliers: [
        {
          title: data.recent_videos[0].title,
          view_count: data.recent_videos[0].view_count,
          multiplier: 7.8,
          published_at: data.recent_videos[0].published_at,
          video_id: data.recent_videos[0].video_id,
          url: data.recent_videos[0].url,
        },
      ],
    }),
    dedupeCandidates: async (_m, candidates) => ({ unique: candidates, duplicates: [] }),
    perplexityResearch: async () => "{}",
    fetchAnalytics: async () => ({ result: [], refreshedToken: undefined }),
    ...overrides,
  });
}

const SCORED = JSON.stringify([
  {
    title: "The Escape Tunnel Nobody Found",
    premise: "p",
    alignment_score: 88,
    subscores: { focus: 33, format: 18, audience: 17, originality: 12, outlier: 8 },
    why_it_fits: "fits",
    why_now: "now",
    recommended_format_angle: "angle",
  },
]);

async function truncate() {
  await getPool().query(
    `TRUNCATE users, sessions, profiles, idea_memory, reports, channel_tokens, usage_events,
     thumbnail_styles, thumbnail_references, thumbnail_generations CASCADE`,
  );
}

async function register(email: string): Promise<string> {
  const res = await request(app).post("/api/auth/register").send({ email, password: "password123", name: email });
  return res.headers["set-cookie"][0].split(";")[0];
}

async function makeProfile(cookie: string): Promise<string> {
  stubReasoning.enqueue(
    JSON.stringify({
      niche: "WW2 escapes",
      format_style: "20min",
      tone: "tense",
      house_style_notes: "h",
      recent_topics: [],
    }),
  );
  const preview = await request(app)
    .post("/api/profiles/preview")
    .set("Cookie", cookie)
    .send({
      channel_url: "https://youtube.com/@atriumexplores",
      focus_statement: "escape stories",
      user_style_description: "cinematic",
      resources: [],
      competitors: [{ url: "https://youtube.com/@rivaldocs" }],
      audience: { age_ranges: ["25-34"], top_countries: ["US"] },
    });
  const saved = await request(app)
    .post("/api/profiles")
    .set("Cookie", cookie)
    .send({ slug: preview.body.slug, data: preview.body.data });
  return saved.body.profile.id;
}

beforeAll(async () => {
  await migrate();
  app = createApp();
});

beforeEach(async () => {
  await truncate();
  stubReasoning = new StubReasoningAdapter();
  setReasoningAdapter(stubReasoning);
  stubHiggsfield = new StubHiggsfieldClient();
  setHiggsfieldClient(stubHiggsfield);
  stubScripts();
});

afterAll(async () => {
  await closePool();
});

describe("competitor analysis + recombination", () => {
  const ANALYSIS = JSON.stringify({
    outlier_breakdowns: [
      {
        channel: "Rival Docs",
        title: "The Lost Submarine",
        url: "https://youtu.be/v1",
        view_count: 900000,
        multiplier: 7.8,
        thumbnail: "dark, single sub",
        topic: "Submarines",
        format: "The Lost ___",
        why_it_overperformed: "strong hook",
        transcript_accessed: true,
      },
    ],
    topic_bank: ["Submarines", "Tunnels"],
    format_bank: ["The Lost ___", "The Evil Design of ___"],
    cross_channel_notes: "mystery framings win",
  });

  it("runs deep analysis and then recombination from the saved report", async () => {
    const cookie = await register("a@telos.so");
    const profileId = await makeProfile(cookie);

    stubScripts({ perplexityResearch: async () => ANALYSIS });
    const analysis = await request(app)
      .post(`/api/profiles/${profileId}/competitor-analysis`)
      .set("Cookie", cookie)
      .send({});
    expect(analysis.status).toBe(200);
    expect(analysis.body.analysis.topic_bank).toContain("Submarines");
    expect(analysis.body.meta.outliers_analyzed).toBeGreaterThan(0);

    // Recombination: prompt 04 raw ideas, then prompt 02 scoring.
    stubReasoning.enqueue(
      JSON.stringify([
        { title: "The Lost Escape Route", premise: "p", source_format: "The Lost ___", source_topic: "Tunnels", generation_mode: "cross-recombination", novelty: "high", fit_note: "fits" },
      ]),
      SCORED,
    );
    const recomb = await request(app)
      .post(`/api/profiles/${profileId}/recombine`)
      .set("Cookie", cookie)
      .send({ competitor_report_id: analysis.body.reportId });
    expect(recomb.status).toBe(200);
    expect(recomb.body.ideas).toHaveLength(1);
    expect(recomb.body.meta.source).toBe("recombination");

    // The recombination prompt (04) received the format bank.
    const recombPrompt = stubReasoning.requests.at(-2)!;
    expect(recombPrompt.user).toContain("The Lost ___");

    // Memory now holds the selected idea.
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM idea_memory");
    expect(rows[0].n).toBe(1);
  });

  it("blocks recombination against another user's competitor report", async () => {
    const alice = await register("alice@telos.so");
    const bob = await register("bob@telos.so");
    const aliceProfile = await makeProfile(alice);
    stubScripts({ perplexityResearch: async () => ANALYSIS });
    const analysis = await request(app)
      .post(`/api/profiles/${aliceProfile}/competitor-analysis`)
      .set("Cookie", alice)
      .send({});
    const bobProfile = await makeProfile(bob);
    const res = await request(app)
      .post(`/api/profiles/${bobProfile}/recombine`)
      .set("Cookie", bob)
      .send({ competitor_report_id: analysis.body.reportId });
    // Bob cannot read Alice's private report → 403 from the data layer.
    expect(res.status).toBe(403);
  });
});

describe("performance tracker", () => {
  it("stays locked until connected, then syncs and writes learnings back", async () => {
    const cookie = await register("a@telos.so");
    const profileId = await makeProfile(cookie);

    const locked = await request(app).get(`/api/profiles/${profileId}/connection`).set("Cookie", cookie);
    expect(locked.body.connected).toBe(false);

    const syncLocked = await request(app)
      .post(`/api/profiles/${profileId}/performance-sync`)
      .set("Cookie", cookie)
      .send({});
    expect(syncLocked.status).toBe(400); // not connected

    // Simulate a completed OAuth connection (token stored encrypted + connected).
    const pool = getPool();
    const { rows: u } = await pool.query("SELECT * FROM users WHERE email = 'a@telos.so'");
    const data = new ScopedData(pool, { id: u[0].id, email: u[0].email, name: u[0].name, role: u[0].role });
    const profile = await data.getProfile(profileId);
    await data.saveChannelToken(profileId, JSON.stringify({ refresh_token: "rt", token: "at" }), "UCmain");
    await markConnected(data, profile, "UCmain");

    // Stub analytics + the learnings model output.
    stubScripts({
      fetchAnalytics: async () => ({
        result: [
          { video: "The Escape Tunnel Nobody Found", views: 500000, averageViewPercentage: 62, averageViewDuration: 700, performance_rank: "1 of 10" },
        ],
        refreshedToken: undefined,
      }),
    });
    stubReasoning.enqueue(
      JSON.stringify({
        calibration: { well_calibrated: true, notes: "ok", suggested_weight_change: null },
        working: ["mystery hooks"],
        not_working: ["long intros"],
        learnings: ["Open mid-action; escape topics over-index."],
      }),
    );
    const sync = await request(app).post(`/api/profiles/${profileId}/performance-sync`).set("Cookie", cookie).send({});
    expect(sync.status).toBe(200);
    expect(sync.body.learnings).toContain("Open mid-action; escape topics over-index.");

    // Learnings are written back into the profile.
    const refreshed = await request(app).get(`/api/profiles/${profileId}`).set("Cookie", cookie);
    expect(refreshed.body.profile.data.learnings).toContain("Open mid-action; escape topics over-index.");
  });
});

describe("retention lab (image path)", () => {
  it("analyzes an uploaded screenshot and saves next_video_rules", async () => {
    const cookie = await register("a@telos.so");
    const profileId = await makeProfile(cookie);
    stubReasoning.enqueue(
      JSON.stringify({
        overall: { chart_type: "dynamic", journey_pattern: "swoop", top_level_fix: "tighten intro" },
        sections: [
          { timespan: "0:00-0:30 (approx)", curve_behaviour: "dip", pattern: "Exposition dip", likely_cause: "slow intro", note_type: "Mistake", fix: "cut setup" },
        ],
        top_fixes: ["cut intro"],
        next_video_rules: ["Open on the hook within 10s"],
      }) + "\nA 20-second human summary.",
    );
    const res = await request(app)
      .post(`/api/profiles/${profileId}/retention-lab`)
      .set("Cookie", cookie)
      .send({
        video_title: "The Lost Submarine",
        video_length: "18:42",
        image: { data: Buffer.from("fake-png").toString("base64"), media_type: "image/png" },
      });
    expect(res.status).toBe(200);
    expect(res.body.analysis.next_video_rules).toContain("Open on the hook within 10s");
    expect(res.body.summary).toContain("human summary");

    // The reasoning call carried the image (vision path).
    const req = stubReasoning.requests.at(-1)!;
    expect(req.images).toHaveLength(1);
  });
});

describe("thumbnail lab (isolated)", () => {
  it("stores style + references, generates via Higgsfield, and scopes per user", async () => {
    const alice = await register("alice@telos.so");
    const slug = "atriumexplores";

    await request(app)
      .put(`/api/thumbnail-lab/${slug}/style`)
      .set("Cookie", alice)
      .send({
        descriptor: { visual_style: { palette: ["teal", "amber"], mood: "tense" } },
        negative_style: ["no cartoon colours"],
      });
    const ref = await request(app)
      .post(`/api/thumbnail-lab/${slug}/references`)
      .set("Cookie", alice)
      .send({ filename: "ref1.png", note: "hero shot", media_type: "image/png", data: Buffer.from("img").toString("base64") });
    expect(ref.status).toBe(201);

    stubHiggsfield.enqueue({ images: ["https://higgsfield.example/out.png"], model: "nano-banana-pro" });
    const gen = await request(app)
      .post(`/api/thumbnail-lab/${slug}/generate`)
      .set("Cookie", alice)
      .send({ request: "thumbnail for the ratlines out of Europe" });
    expect(gen.status).toBe(200);
    expect(gen.body.images[0]).toContain("higgsfield.example");
    // The Higgsfield prompt fused the request with the stored style + negatives.
    const hReq = stubHiggsfield.requests.at(-1)!;
    expect(hReq.prompt).toContain("ratlines");
    expect(hReq.prompt).toContain("tense");
    expect(hReq.prompt).toContain("Avoid: no cartoon colours");
    expect(hReq.references).toHaveLength(1);

    // Bob sees an empty store for the same slug — visual stores are per user.
    const bob = await register("bob@telos.so");
    const bobStyle = await request(app).get(`/api/thumbnail-lab/${slug}/style`).set("Cookie", bob);
    expect(bobStyle.body.references).toHaveLength(0);
    expect(bobStyle.body.generations).toHaveLength(0);
  });
});
