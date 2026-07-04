/**
 * Company-credentials service.
 *
 * All third-party API keys are COMPANY-provisioned and live only in server-side
 * env. This module is the single gate to them:
 *
 *   - Nothing outside this file reads the key env vars.
 *   - Keys are handed out per-service, so a caller gets only the key it needs
 *     (e.g. the script runner injects YOUTUBE_API_KEY into fetch_channel_data.py
 *     and nothing else).
 *   - Keys are never sent to the browser and never stored per-user.
 *
 * Per-user YouTube OAuth tokens are a different thing entirely — they live
 * encrypted in the channel_tokens table (see credentials/tokenCrypto.ts and the
 * data layer), not here.
 */

export type CompanyService = "youtube" | "perplexity" | "anthropic" | "higgsfield";

const ENV_NAMES: Record<CompanyService, string> = {
  youtube: "YOUTUBE_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  higgsfield: "HIGGSFIELD_API_KEY",
};

export class MissingCredentialError extends Error {
  readonly service: CompanyService;
  constructor(service: CompanyService) {
    super(
      `Company credential for "${service}" is not configured (${ENV_NAMES[service]}). ` +
        `An admin must set it in the server environment.`,
    );
    this.service = service;
  }
}

/** Returns the company API key for a service, or throws MissingCredentialError. */
export function getCompanyKey(service: CompanyService): string {
  const v = process.env[ENV_NAMES[service]];
  if (!v) throw new MissingCredentialError(service);
  return v;
}

/** Non-throwing presence check, for the admin status view. Never returns the key. */
export function credentialStatus(): Record<CompanyService, boolean> {
  return {
    youtube: Boolean(process.env[ENV_NAMES.youtube]),
    perplexity: Boolean(process.env[ENV_NAMES.perplexity]),
    anthropic: Boolean(process.env[ENV_NAMES.anthropic]),
    higgsfield: Boolean(process.env[ENV_NAMES.higgsfield]),
  };
}
