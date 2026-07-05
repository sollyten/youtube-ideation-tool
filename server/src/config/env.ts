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
  /**
   * Perplexity research: Sonar API for idea generation (prompt 01, model
   * selectable per run) and the Agent API for competitor analysis (prompt 03).
   */
  perplexity: {
    get baseUrl(): string {
      return optional("PERPLEXITY_BASE_URL", "https://api.perplexity.ai");
    },
    /** Default Sonar model for ideation when the run doesn't specify one. */
    get ideationModel(): string {
      return optional("PERPLEXITY_IDEATION_MODEL", "sonar-deep-research");
    },
    /** Agent API endpoint path + model, config-driven to match the live API. */
    get agentPath(): string {
      return optional("PERPLEXITY_AGENT_PATH", "/v1/agent");
    },
    get agentModel(): string {
      return optional("PERPLEXITY_AGENT_MODEL", "sonar-pro");
    },
    get timeoutMs(): number {
      return intOption("PERPLEXITY_TIMEOUT_MS", 8 * 60 * 1000);
    },
  },
  /** Public base URL the browser reaches this app on (for OAuth redirect fallback). */
  get appBaseUrl(): string {
    return optional("APP_BASE_URL", `http://localhost:${this.port}`);
  },
  /**
   * Google OAuth client for per-director YouTube analytics authorization.
   * This is the app's identity (shared), NOT a per-user secret — the per-user
   * token it mints is stored encrypted in channel_tokens.
   */
  googleOAuth: {
    get clientId(): string {
      return required("GOOGLE_OAUTH_CLIENT_ID");
    },
    get clientSecret(): string {
      return required("GOOGLE_OAUTH_CLIENT_SECRET");
    },
    get redirectUri(): string {
      return optional("GOOGLE_OAUTH_REDIRECT_URI", `${config.appBaseUrl}/api/oauth/youtube/callback`);
    },
    get configured(): boolean {
      return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
    },
  },
  /**
   * Thumbnail Lab → Higgsfield transport. HIGGSFIELD_ADAPTER selects "http"
   * (default), "mcp", or "stub". In MCP mode the module talks to a Higgsfield
   * MCP server; tool/arg names are configurable so they can be matched to the
   * real server's schema without code changes.
   */
  higgsfieldMcp: {
    get url(): string {
      return optional("HIGGSFIELD_MCP_URL", "");
    },
    get authToken(): string {
      return optional("HIGGSFIELD_MCP_TOKEN", "");
    },
    get tool(): string {
      return optional("HIGGSFIELD_MCP_TOOL", "generate_image");
    },
    get promptArg(): string {
      return optional("HIGGSFIELD_MCP_PROMPT_ARG", "prompt");
    },
    get modelArg(): string {
      return optional("HIGGSFIELD_MCP_MODEL_ARG", "model");
    },
    get referencesArg(): string {
      return optional("HIGGSFIELD_MCP_REFERENCES_ARG", "reference_images");
    },
    get attachedArg(): string {
      return optional("HIGGSFIELD_MCP_ATTACHED_ARG", "attached_image");
    },
    get configured(): boolean {
      return Boolean(process.env.HIGGSFIELD_MCP_URL);
    },
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
    get performance(): number {
      return intOption("QUOTA_PERFORMANCE_PER_DAY", 20);
    },
    get profileBuild(): number {
      return intOption("QUOTA_PROFILE_BUILD_PER_DAY", 20);
    },
  },
};
