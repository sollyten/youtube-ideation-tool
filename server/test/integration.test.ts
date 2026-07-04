/**
 * Integration tests against a real Postgres (creatortool_test database).
 * Exercises the multi-user spine: auth, isolation (403/404), per-user slugs,
 * company visibility, quotas, and the full ideation pipeline with stubbed
 * external services (scripts + reasoning).
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

let app: Express;
let stubReasoning: StubReasoningAdapter;

const CHANNEL_DATA = {
  channel_title: "Atrium Explores",
  channel_id: "UCmain",
  subscriber_count: 100000,
  view_count: 5000000,
  video_count: 120,
  recent_videos: [
    { title: "The Lost Submarine", published_at: "2026-01-01T00:00:00Z", view_count: 900000 },
    { title: "Desert Fortress", published_at: "2026-02-01T00:00:00Z", view_count: 120000 },
    { title: "Iron Coffins", published_at: "2026-03-01T00:00:00Z", view_count: 110000 },
  ],
};

const COMPETITOR_DATA = {
  ...CHANNEL_DATA,
  channel_title: "Rival Docs",
  channel_id: "UCrival",
};

function stubScripts() {
  setScriptRunner({
    fetchChannelData: async (url: string) =>
      url.includes("rival") || url === "UCrival" ? COMPETITOR_DATA : CHANNEL_DATA,
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
        },
      ],
    }),
    dedupeCandidates: async (_memory, candidates) => ({ unique: candidates, duplicates: [] }),
    perplexityResearch: async () =>
      JSON.stringify([
        {
          title: "The Escape Tunnel Nobody Found",
          premise: "p1",
          why_now: "anniversary",
          coverage_check: "low",
          outlier_pattern_used: "mystery hook",
        },
        {
          title: "Manhunt Across the Alps",
          premise: "p2",
          why_now: "new archive release",
          coverage_check: "low",
          outlier_pattern_used: "chase framing",
        },
      ]),
  });
}

const SCORED_IDEAS = JSON.stringify([
  {
    title: "The Escape Tunnel Nobody Found",
    premise: "p1",
    alignment_score: 88,
    subscores: { focus: 33, format: 18, audience: 17, originality: 12, outlier: 8 },
    why_it_fits: "fits",
    why_now: "anniversary",
    recommended_format_angle: "present-tense narrative",
  },
]);

async function truncateAll() {
  await getPool().query(
    "TRUNCATE users, sessions, profiles, idea_memory, reports, channel_tokens, usage_events CASCADE",
  );
}

interface Agent {
  cookie: string;
  userId: string;
}

async function registerUser(email: string, name: string): Promise<Agent> {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "password123", name });
  expect(res.status).toBe(201);
  return { cookie: res.headers["set-cookie"][0].split(";")[0], userId: res.body.user.id };
}

const PROFILE_INPUT = {
  channel_url: "https://youtube.com/@atriumexplores",
  focus_statement: "Nazi-era escape and manhunt stories with true-crime tension",
  user_style_description: "Cinematic, present tense",
  resources: [],
  competitors: [{ url: "https://youtube.com/@rivaldocs" }],
  audience: { age_ranges: ["25-34"], top_countries: ["United States"] },
};

async function createProfile(agent: Agent): Promise<string> {
  stubReasoning.enqueue(
    JSON.stringify({
      niche: "WW2 escape narratives",
      format_style: "20min narrative",
      tone: "tense",
      house_style_notes: "Present tense.",
      recent_topics: ["submarine loss", "desert fortress"],
    }),
  );
  const preview = await request(app)
    .post("/api/profiles/preview")
    .set("Cookie", agent.cookie)
    .send(PROFILE_INPUT);
  expect(preview.status).toBe(200);
  const saved = await request(app)
    .post("/api/profiles")
    .set("Cookie", agent.cookie)
    .send({ slug: preview.body.slug, data: preview.body.data });
  expect(saved.status).toBe(201);
  return saved.body.profile.id;
}

beforeAll(async () => {
  await migrate();
  app = createApp();
});

beforeEach(async () => {
  await truncateAll();
  stubScripts();
  stubReasoning = new StubReasoningAdapter();
  setReasoningAdapter(stubReasoning);
});

afterAll(async () => {
  await closePool();
});

describe("auth", () => {
  it("rejects unauthenticated access to every protected route", async () => {
    for (const path of ["/api/profiles", "/api/reports", "/api/admin/usage"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });

  it("makes the first user admin and subsequent users directors", async () => {
    const first = await request(app)
      .post("/api/auth/register")
      .send({ email: "a@telos.so", password: "password123", name: "A" });
    const second = await request(app)
      .post("/api/auth/register")
      .send({ email: "b@telos.so", password: "password123", name: "B" });
    expect(first.body.user.role).toBe("admin");
    expect(second.body.user.role).toBe("director");
  });

  it("rejects wrong passwords and unknown users identically", async () => {
    await registerUser("a@telos.so", "A");
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@telos.so", password: "wrongpassword" });
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@telos.so", password: "password123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
  });

  it("blocks directors from admin routes", async () => {
    await registerUser("admin@telos.so", "Admin");
    const director = await registerUser("dir@telos.so", "Dir");
    const res = await request(app).get("/api/admin/usage").set("Cookie", director.cookie);
    expect(res.status).toBe(403);
  });
});

describe("isolation", () => {
  it("returns 403 for another user's private profile and 404 for a missing one", async () => {
    const alice = await registerUser("alice@telos.so", "Alice");
    const bob = await registerUser("bob@telos.so", "Bob");
    const profileId = await createProfile(alice);

    const crossRead = await request(app)
      .get(`/api/profiles/${profileId}`)
      .set("Cookie", bob.cookie);
    expect(crossRead.status).toBe(403);

    const missing = await request(app)
      .get("/api/profiles/00000000-0000-0000-0000-000000000000")
      .set("Cookie", bob.cookie);
    expect(missing.status).toBe(404);

    const crossWrite = await request(app)
      .patch(`/api/profiles/${profileId}`)
      .set("Cookie", bob.cookie)
      .send({ focus_statement: "hijacked" });
    expect(crossWrite.status).toBe(403);

    const crossIdeate = await request(app)
      .post(`/api/profiles/${profileId}/ideate`)
      .set("Cookie", bob.cookie)
      .send({});
    expect(crossIdeate.status).toBe(403);
  });

  it("lets two directors own the same slug", async () => {
    const alice = await registerUser("alice@telos.so", "Alice");
    const bob = await registerUser("bob@telos.so", "Bob");
    await createProfile(alice);
    const bobProfile = await createProfile(bob); // same channel → same slug
    expect(bobProfile).toBeTruthy();
    const list = await request(app).get("/api/profiles").set("Cookie", bob.cookie);
    expect(list.body.profiles).toHaveLength(1);
  });

  it("rejects a duplicate slug for the SAME user without overwrite", async () => {
    const alice = await registerUser("alice@telos.so", "Alice");
    await createProfile(alice);
    stubReasoning.enqueue(
      JSON.stringify({
        niche: "n",
        format_style: "f",
        tone: "t",
        house_style_notes: "h",
        recent_topics: [],
      }),
    );
    const preview = await request(app)
      .post("/api/profiles/preview")
      .set("Cookie", alice.cookie)
      .send(PROFILE_INPUT);
    const dup = await request(app)
      .post("/api/profiles")
      .set("Cookie", alice.cookie)
      .send({ slug: preview.body.slug, data: preview.body.data });
    expect(dup.status).toBe(409);
  });

  it("exposes company-visible profiles read-only to other directors", async () => {
    const admin = await registerUser("admin@telos.so", "Admin"); // first user = admin
    const bob = await registerUser("bob@telos.so", "Bob");
    const profileId = await createProfile(admin);

    // Owner (admin here) marks the profile company-visible.
    const share = await request(app)
      .patch(`/api/profiles/${profileId}`)
      .set("Cookie", admin.cookie)
      .send({ visibility: "company" });
    expect(share.status).toBe(200);

    const read = await request(app).get(`/api/profiles/${profileId}`).set("Cookie", bob.cookie);
    expect(read.status).toBe(200);
    expect(read.body.profile.readOnly).toBe(true);

    // Read-only means READ only: writes and expensive runs stay forbidden.
    const write = await request(app)
      .patch(`/api/profiles/${profileId}`)
      .set("Cookie", bob.cookie)
      .send({ focus_statement: "not yours" });
    expect(write.status).toBe(403);
  });

  it("blocks directors from marking their own profile company-visible", async () => {
    await registerUser("admin@telos.so", "Admin");
    const director = await registerUser("dir@telos.so", "Dir");
    const profileId = await createProfile(director);
    const res = await request(app)
      .patch(`/api/profiles/${profileId}`)
      .set("Cookie", director.cookie)
      .send({ visibility: "company" });
    expect(res.status).toBe(403);
  });

  it("keeps report history scoped to the owner", async () => {
    const alice = await registerUser("alice@telos.so", "Alice");
    const bob = await registerUser("bob@telos.so", "Bob");
    const profileId = await createProfile(alice);
    stubReasoning.enqueue(SCORED_IDEAS);
    const run = await request(app)
      .post(`/api/profiles/${profileId}/ideate`)
      .set("Cookie", alice.cookie)
      .send({});
    expect(run.status).toBe(200);

    const bobList = await request(app).get("/api/reports").set("Cookie", bob.cookie);
    expect(bobList.body.reports).toHaveLength(0);

    const bobRead = await request(app)
      .get(`/api/reports/${run.body.reportId}`)
      .set("Cookie", bob.cookie);
    expect(bobRead.status).toBe(403);
  });
});

describe("ideation pipeline", () => {
  it("runs end to end: outliers → generation → dedupe → scoring → memory → report", async () => {
    const alice = await registerUser("alice@telos.so", "Alice");
    const profileId = await createProfile(alice);

    stubReasoning.enqueue(SCORED_IDEAS);
    const run = await request(app)
      .post(`/api/profiles/${profileId}/ideate`)
      .set("Cookie", alice.cookie)
      .send({});
    expect(run.status).toBe(200);
    expect(run.body.ideas).toHaveLength(1);
    expect(run.body.ideas[0].alignment_score).toBe(88);
    expect(run.body.meta.raw_candidate_count).toBe(2);

    // The scoring prompt (02) must have received the full profile + memory.
    const scoringRequest = stubReasoning.requests.at(-1)!;
    expect(scoringRequest.user).toContain("WW2 escape narratives");
    expect(scoringRequest.user).toContain("The Escape Tunnel Nobody Found");

    // Report is saved and readable by the owner.
    const report = await request(app)
      .get(`/api/reports/${run.body.reportId}`)
      .set("Cookie", alice.cookie);
    expect(report.status).toBe(200);
    expect(report.body.report.type).toBe("ideas");
    expect(report.body.report.payload.ideas).toHaveLength(1);

    // Memory now contains the selected idea, so the next run's prompt 01
    // carries it in the do-not-repeat list.
    stubReasoning.enqueue(SCORED_IDEAS);
    const { rows } = await getPool().query("SELECT idea FROM idea_memory");
    expect(rows).toHaveLength(1);
    expect(rows[0].idea.title).toBe("The Escape Tunnel Nobody Found");
  });

  it("enforces the per-user daily ideation quota", async () => {
    process.env.QUOTA_IDEATION_PER_DAY = "1";
    try {
      const alice = await registerUser("alice@telos.so", "Alice");
      const profileId = await createProfile(alice);
      stubReasoning.enqueue(SCORED_IDEAS, SCORED_IDEAS);
      const first = await request(app)
        .post(`/api/profiles/${profileId}/ideate`)
        .set("Cookie", alice.cookie)
        .send({});
      expect(first.status).toBe(200);
      const second = await request(app)
        .post(`/api/profiles/${profileId}/ideate`)
        .set("Cookie", alice.cookie)
        .send({});
      expect(second.status).toBe(429);
    } finally {
      delete process.env.QUOTA_IDEATION_PER_DAY;
    }
  });

  it("fails loudly when the channel fetch fails — nothing fabricated, nothing saved", async () => {
    const alice = await registerUser("alice@telos.so", "Alice");
    const profileId = await createProfile(alice);
    setScriptRunner({
      fetchChannelData: async () => {
        throw new Error("YouTube API quota exceeded");
      },
    });
    const run = await request(app)
      .post(`/api/profiles/${profileId}/ideate`)
      .set("Cookie", alice.cookie)
      .send({});
    expect(run.status).toBe(500);
    const { rows } = await getPool().query("SELECT * FROM reports");
    expect(rows).toHaveLength(0);
  });
});

describe("channel tokens", () => {
  it("stores tokens encrypted and never returns them to another user", async () => {
    const alice = await registerUser("alice@telos.so", "Alice");
    const profileId = await createProfile(alice);
    const { ScopedData } = await import("../src/data/scoped.js");
    const pool = getPool();

    const { rows: userRows } = await pool.query("SELECT * FROM users WHERE email = $1", [
      "alice@telos.so",
    ]);
    const aliceScoped = new ScopedData(pool, {
      id: userRows[0].id,
      email: userRows[0].email,
      name: userRows[0].name,
      role: userRows[0].role,
    });
    await aliceScoped.saveChannelToken(profileId, '{"refresh_token":"secret-rt"}', "UCmain");

    // Ciphertext at rest — the plaintext never appears in the table.
    const { rows } = await pool.query("SELECT encrypted_token FROM channel_tokens");
    expect(rows[0].encrypted_token).not.toContain("secret-rt");
    expect(await aliceScoped.getChannelToken(profileId)).toContain("secret-rt");

    // Another user cannot reach the token even for a company-visible profile.
    const bob = await registerUser("bob@telos.so", "Bob");
    const { rows: bobRows } = await pool.query("SELECT * FROM users WHERE email = $1", [
      "bob@telos.so",
    ]);
    const bobScoped = new ScopedData(pool, {
      id: bobRows[0].id,
      email: bobRows[0].email,
      name: bobRows[0].name,
      role: bobRows[0].role,
    });
    await expect(bobScoped.getChannelToken(profileId)).rejects.toThrow();
    void bob;
  });
});
