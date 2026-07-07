/**
 * Dev-only seed: creates a demo director with one profile and one saved idea
 * run, so the UI can be exercised without any external API keys.
 *
 *   npm run migrate --workspace server
 *   npx tsx server/src/dev/seed.ts
 *
 * Sign in as demo@telos.so / password123.
 */
import { loadEnv } from "../config/loadEnv.js";
loadEnv(); // must run before ../db/pool.js reads config.databaseUrl, or a
// configured .env DATABASE_URL is silently ignored in favor of the default.
import { getPool, closePool } from "../db/pool.js";
import { hashPassword } from "../auth/passwords.js";
import { ScopedData } from "../data/scoped.js";

async function main(): Promise<void> {
  const pool = getPool();
  const passwordHash = await hashPassword("password123");
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, role, password_hash)
     VALUES ('demo@telos.so', 'Demo Director', 'director', $1)
     ON CONFLICT (email) DO UPDATE SET password_hash = $1
     RETURNING id, email, name, role`,
    [passwordHash],
  );
  const user = rows[0];
  const scoped = new ScopedData(pool, user);

  const now = new Date().toISOString();
  const profile = await scoped.createProfile({
    slug: "atriumexplores",
    overwrite: true,
    data: {
      slug: "atriumexplores",
      channel_name: "Atrium Explores",
      channel_url: "https://youtube.com/@atriumexplores",
      channel_id: "UCdemo123",
      focus: {
        statement: "Nazi-era escape and manhunt stories told with true-crime tension",
        last_updated: now,
      },
      user_style_description: "Cinematic, present-tense storytelling with a slow-burn reveal.",
      resources: [],
      competitors: [
        { name: "Rival Docs", url: "https://youtube.com/@rivaldocs", channel_id: "UCrival" },
      ],
      audience: { age_ranges: ["25-34", "35-44", "18-24"], top_countries: ["United States", "United Kingdom", "Germany"] },
      niche: "WW2 escape and evasion narratives",
      format_style: "obstacle-based narrative, present tense, ~20min",
      tone: "tense, restrained, factual",
      house_style_notes: "Opens mid-action. Never reveals the outcome before the final act.",
      recent_topics: ["submarine loss 1943", "desert fortress siege", "POW tunnel network"],
      connections: { youtube_analytics: { connected: false, channel_id: "", token_ref: "", connected_at: "" } },
      learnings: [],
      stats: {
        subscriber_count: 184000,
        view_count: 21000000,
        video_count: 96,
        median_views: 138000,
        snapshot_date: now,
      },
      created_at: now,
      updated_at: now,
    },
  });

  const ideas = [
    {
      title: "The Escape Tunnel the Gestapo Never Found",
      premise: "A forgotten tunnel under Stalag Luft III stayed hidden until 2004.",
      alignment_score: 91,
      subscores: { focus: 34, format: 19, audience: 18, originality: 12, outlier: 8 },
      why_it_fits: "Direct hit on the escape/manhunt focus with a mystery reveal structure.",
      why_now: "80th-anniversary coverage resurfacing in archives this year.",
      recommended_format_angle: "Present-tense countdown from the first dig to discovery.",
    },
    {
      title: "Manhunt Across the Alps: The Officer Who Vanished Twice",
      premise: "One escapee crossed three borders while being hunted by two armies.",
      alignment_score: 84,
      subscores: { focus: 31, format: 18, audience: 17, originality: 11, outlier: 7 },
      why_it_fits: "Chase framing proven by the channel's own outliers.",
      why_now: "Newly digitized Swiss border records published last month.",
      recommended_format_angle: "Map-driven pursuit with dated checkpoints.",
    },
  ];
  const report = await scoped.createReport(profile.id, "ideas", {
    ideas,
    drop_note: "Dropped 4 near-duplicates of past tunnel-escape ideas in STEP 1.",
    my_outliers: [{ title: "The Lost Submarine", view_count: 900000, multiplier: 6.5, published_at: now }],
    competitor_outliers: [],
    meta: {
      idea_count_requested: 60,
      raw_candidate_count: 58,
      unique_candidate_count: 54,
      duplicates_dropped_pre_scoring: 4,
      duplicates_dropped_post_scoring: 0,
      baseline: 138000,
      my_outlier_count: 1,
      competitor_channels_analyzed: 1,
      fetch_errors: [],
      duration_ms: 184000,
    },
  });
  await scoped.appendIdeaMemory(
    profile.id,
    ideas.map((i) => ({ title: i.title, premise: i.premise, alignment_score: i.alignment_score, generated_at: now })),
  );

  console.log(`Seeded demo@telos.so / password123 — profile ${profile.id}, report ${report.id}`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
