/**
 * Central environment configuration.
 *
 * Everything here is SERVER-SIDE ONLY. Company API keys are read exactly once,
 * through the credentials service (credentials/companyCredentials.ts) — nothing
 * else in the codebase touches process.env for secrets, and no secret is ever
 * serialized into an HTTP response.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function intOption(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer`);
  return n;
}

export const config = {
  get port(): number {
    return intOption("PORT", 3000);
  },
  get databaseUrl(): string {
    return optional("DATABASE_URL", "postgres://creator:creator@127.0.0.1:5432/creatortool");
  },
  get authSecret(): string {
    return required("AUTH_SECRET");
  },
  /** Root of the repo, where prompts/, scripts/, knowledge/ live. */
  get repoRoot(): string {
    return optional("REPO_ROOT", new URL("../../..", import.meta.url).pathname);
  },
  get nodeEnv(): string {
    return optional("NODE_ENV", "development");
  },
  /** Which reasoning adapter to use: "anthropic" (default) or "stub" (tests/dev). */
  get reasoningAdapter(): string {
    return optional("REASONING_ADAPTER", "anthropic");
  },
  /** Per-user daily quotas on expensive actions (usage bills to the company). */
  quotas: {
    get ideation(): number {
      return intOption("QUOTA_IDEATION_PER_DAY", 10);
    },
    get competitorAnalysis(): number {
      return intOption("QUOTA_COMPETITOR_PER_DAY", 10);
    },
    get retention(): number {
      return intOption("QUOTA_RETENTION_PER_DAY", 20);
    },
    get profileBuild(): number {
      return intOption("QUOTA_PROFILE_BUILD_PER_DAY", 20);
    },
  },
};
