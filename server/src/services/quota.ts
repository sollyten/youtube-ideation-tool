/**
 * Per-user quotas on the expensive actions. All API spend bills to the
 * company, so each director gets a rolling 24-hour allowance per action.
 */
import type { ScopedData } from "../data/scoped.js";
import { config } from "../config/env.js";
import { QuotaExceededError } from "../errors.js";

export type MeteredAction = "ideation" | "competitor_analysis" | "retention" | "profile_build";

const LIMITS: Record<MeteredAction, () => number> = {
  ideation: () => config.quotas.ideation,
  competitor_analysis: () => config.quotas.competitorAnalysis,
  retention: () => config.quotas.retention,
  profile_build: () => config.quotas.profileBuild,
};

/** Throws 429 when the user has exhausted the action's daily allowance. */
export async function assertQuota(scoped: ScopedData, action: MeteredAction): Promise<void> {
  const limit = LIMITS[action]();
  const used = await scoped.countUsageLastDay(action);
  if (used >= limit) {
    throw new QuotaExceededError(
      `Daily limit reached for ${action.replace("_", " ")} (${used}/${limit} in the last 24h). ` +
        `Try again later or ask an admin to raise the quota.`,
    );
  }
}
