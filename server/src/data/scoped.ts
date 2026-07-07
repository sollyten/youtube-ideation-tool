/**
 * THE user-scoped data-access layer. All persistence goes through here.
 *
 * A ScopedData instance is bound to the authenticated user for one request.
 * Every read and write is filtered by owner_user_id at the SQL level; the only
 * cross-user path is read-only access to profiles marked visibility='company'
 * (and their reports/idea memory). Channel OAuth tokens are NEVER shared, not
 * even for company-visible profiles.
 *
 * Access semantics (SPEC §1): requesting a record that does not exist → 404;
 * requesting a record that exists but belongs to another user (and is not
 * company-visible) → 403. Enforced here, not in the UI.
 */
import type pg from "pg";
import { ForbiddenError, NotFoundError, ConflictError } from "../errors.js";
import { encryptToken, decryptToken } from "../credentials/tokenCrypto.js";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: "director" | "admin";
}

export interface ProfileRecord {
  id: string;
  ownerUserId: string;
  slug: string;
  visibility: "private" | "company";
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** True when the current user is not the owner (company-visible read). */
  readOnly: boolean;
}

export interface ReportRecord {
  id: string;
  profileId: string;
  type: "ideas" | "competitor" | "retention" | "performance";
  payload: Record<string, unknown>;
  createdAt: string;
}

export type ReportType = ReportRecord["type"];

export interface IdeaFeedbackRecord {
  id: string;
  profileId: string;
  reportId: string;
  selected: Array<{ title: string; premise: string }>;
  passed: string[];
  comments: string;
  createdAt: string;
}

function toIdeaFeedback(row: any): IdeaFeedbackRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    reportId: row.report_id,
    selected: row.selected,
    passed: row.passed,
    comments: row.comments,
    createdAt: row.created_at.toISOString(),
  };
}

function toProfile(row: any, currentUserId: string): ProfileRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    slug: row.slug,
    visibility: row.visibility,
    data: row.data,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    readOnly: row.owner_user_id !== currentUserId,
  };
}

export class ScopedData {
  constructor(
    private readonly db: pg.Pool,
    readonly user: CurrentUser,
  ) {}

  // ---------------------------------------------------------------- profiles

  /**
   * Fetch a profile and enforce access. mode "write" requires ownership;
   * mode "read" also accepts visibility='company'.
   */
  private async requireProfile(profileId: string, mode: "read" | "write"): Promise<ProfileRecord> {
    const { rows } = await this.db.query("SELECT * FROM profiles WHERE id = $1", [profileId]);
    if (rows.length === 0) throw new NotFoundError("Profile not found");
    const profile = toProfile(rows[0], this.user.id);
    if (!profile.readOnly) return profile;
    if (mode === "read" && profile.visibility === "company") return profile;
    throw new ForbiddenError("This profile belongs to another user");
  }

  async getProfile(profileId: string): Promise<ProfileRecord> {
    return this.requireProfile(profileId, "read");
  }

  /** Slug lookup is always within the current user's own namespace. */
  async getOwnProfileBySlug(slug: string): Promise<ProfileRecord | undefined> {
    const { rows } = await this.db.query(
      "SELECT * FROM profiles WHERE owner_user_id = $1 AND slug = $2",
      [this.user.id, slug],
    );
    return rows[0] ? toProfile(rows[0], this.user.id) : undefined;
  }

  /** Own profiles plus other users' company-visible profiles (read-only). */
  async listProfiles(): Promise<ProfileRecord[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM profiles
       WHERE owner_user_id = $1 OR visibility = 'company'
       ORDER BY (owner_user_id = $1) DESC, updated_at DESC`,
      [this.user.id],
    );
    return rows.map((r) => toProfile(r, this.user.id));
  }

  async createProfile(input: {
    slug: string;
    data: Record<string, unknown>;
    visibility?: "private" | "company";
    overwrite?: boolean;
  }): Promise<ProfileRecord> {
    const existing = await this.getOwnProfileBySlug(input.slug);
    if (existing && !input.overwrite) {
      throw new ConflictError(
        `You already have a profile with slug "${input.slug}". Pass overwrite to replace it.`,
      );
    }
    if (existing) {
      return this.updateProfile(existing.id, { data: input.data });
    }
    const { rows } = await this.db.query(
      `INSERT INTO profiles (owner_user_id, slug, visibility, data)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [this.user.id, input.slug, input.visibility ?? "private", input.data],
    );
    return toProfile(rows[0], this.user.id);
  }

  async updateProfile(
    profileId: string,
    patch: { data?: Record<string, unknown>; visibility?: "private" | "company" },
  ): Promise<ProfileRecord> {
    await this.requireProfile(profileId, "write");
    // Only an admin may mark a profile company-visible (SPEC §9); the owner can
    // always take it back to private.
    if (patch.visibility === "company" && this.user.role !== "admin") {
      throw new ForbiddenError("Only an admin can make a profile company-visible");
    }
    const { rows } = await this.db.query(
      `UPDATE profiles
       SET data = COALESCE($3, data),
           visibility = COALESCE($4, visibility),
           updated_at = now()
       WHERE id = $1 AND owner_user_id = $2
       RETURNING *`,
      [profileId, this.user.id, patch.data ?? null, patch.visibility ?? null],
    );
    if (rows.length === 0) throw new NotFoundError("Profile not found");
    return toProfile(rows[0], this.user.id);
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.requireProfile(profileId, "write");
    await this.db.query("DELETE FROM profiles WHERE id = $1 AND owner_user_id = $2", [
      profileId,
      this.user.id,
    ]);
  }

  // ------------------------------------------------------------- idea memory

  /** All remembered ideas for a profile (the no-repeat store). */
  async listIdeaMemory(profileId: string): Promise<Array<Record<string, unknown>>> {
    const profile = await this.requireProfile(profileId, "read");
    const { rows } = await this.db.query(
      "SELECT idea FROM idea_memory WHERE owner_user_id = $1 AND profile_id = $2 ORDER BY created_at",
      [profile.ownerUserId, profileId],
    );
    return rows.map((r) => r.idea);
  }

  async appendIdeaMemory(profileId: string, ideas: Array<Record<string, unknown>>): Promise<void> {
    await this.requireProfile(profileId, "write");
    for (const idea of ideas) {
      await this.db.query(
        "INSERT INTO idea_memory (owner_user_id, profile_id, idea) VALUES ($1, $2, $3)",
        [this.user.id, profileId, idea],
      );
    }
  }

  // ----------------------------------------------------------------- reports

  async createReport(
    profileId: string,
    type: ReportType,
    payload: Record<string, unknown>,
  ): Promise<ReportRecord> {
    await this.requireProfile(profileId, "write");
    const { rows } = await this.db.query(
      `INSERT INTO reports (owner_user_id, profile_id, type, payload)
       VALUES ($1, $2, $3, $4) RETURNING id, profile_id, type, payload, created_at`,
      [this.user.id, profileId, type, payload],
    );
    const r = rows[0];
    return {
      id: r.id,
      profileId: r.profile_id,
      type: r.type,
      payload: r.payload,
      createdAt: r.created_at.toISOString(),
    };
  }

  /** History listing: strictly the current user's own reports. */
  async listOwnReports(filter: { profileId?: string; type?: ReportType } = {}): Promise<
    Array<Omit<ReportRecord, "payload">>
  > {
    const clauses = ["owner_user_id = $1"];
    const params: unknown[] = [this.user.id];
    if (filter.profileId) {
      params.push(filter.profileId);
      clauses.push(`profile_id = $${params.length}`);
    }
    if (filter.type) {
      params.push(filter.type);
      clauses.push(`type = $${params.length}`);
    }
    const { rows } = await this.db.query(
      `SELECT id, profile_id, type, created_at FROM reports
       WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      profileId: r.profile_id,
      type: r.type,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** Reports attached to a readable profile (includes company-visible shares). */
  async listProfileReports(profileId: string, type?: ReportType): Promise<
    Array<Omit<ReportRecord, "payload">>
  > {
    const profile = await this.requireProfile(profileId, "read");
    const params: unknown[] = [profile.ownerUserId, profileId];
    let sql = `SELECT id, profile_id, type, created_at FROM reports
               WHERE owner_user_id = $1 AND profile_id = $2`;
    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }
    const { rows } = await this.db.query(sql + " ORDER BY created_at DESC", params);
    return rows.map((r) => ({
      id: r.id,
      profileId: r.profile_id,
      type: r.type,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async getReport(reportId: string): Promise<ReportRecord> {
    const { rows } = await this.db.query("SELECT * FROM reports WHERE id = $1", [reportId]);
    if (rows.length === 0) throw new NotFoundError("Report not found");
    const r = rows[0];
    if (r.owner_user_id !== this.user.id) {
      // A report is readable cross-user only through a company-visible profile.
      await this.requireProfile(r.profile_id, "read");
    }
    return {
      id: r.id,
      profileId: r.profile_id,
      type: r.type,
      payload: r.payload,
      createdAt: r.created_at.toISOString(),
    };
  }

  // ------------------------------------------------------------ idea feedback

  /**
   * Save the director's picks for an ideas report (the optional post-run
   * query). Titles are validated against the report's ideas; everything shown
   * but not picked is stored as the negative signal. Idempotent per report —
   * re-submitting replaces the earlier answer.
   */
  async saveIdeaFeedback(
    reportId: string,
    input: { selectedTitles: string[]; comments?: string },
  ): Promise<IdeaFeedbackRecord> {
    const report = await this.getReport(reportId);
    if (report.type !== "ideas") throw new ConflictError("Feedback only applies to idea reports");
    await this.requireProfile(report.profileId, "write"); // owner-only, like any training signal
    const ideas = (report.payload.ideas ?? []) as Array<{ title: string; premise?: string }>;
    const byTitle = new Map(ideas.map((i) => [i.title, i]));
    const picks = [...new Set(input.selectedTitles)].filter((t) => byTitle.has(t));
    if (picks.length !== new Set(input.selectedTitles).size) {
      throw new ConflictError("One or more selected titles are not in this report");
    }
    const selected = picks.map((t) => ({ title: t, premise: byTitle.get(t)?.premise ?? "" }));
    const passed = ideas.map((i) => i.title).filter((t) => !picks.includes(t));
    const { rows } = await this.db.query(
      `INSERT INTO idea_feedback (owner_user_id, profile_id, report_id, selected, passed, comments)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (owner_user_id, report_id)
       DO UPDATE SET selected = $4, passed = $5, comments = $6, created_at = now()
       RETURNING *`,
      [
        this.user.id,
        report.profileId,
        reportId,
        JSON.stringify(selected),
        JSON.stringify(passed),
        input.comments ?? "",
      ],
    );
    return toIdeaFeedback(rows[0]);
  }

  /** The current user's feedback on one report, if they have given any. */
  async getIdeaFeedback(reportId: string): Promise<IdeaFeedbackRecord | undefined> {
    await this.getReport(reportId); // enforces read access (404/403 semantics)
    const { rows } = await this.db.query(
      "SELECT * FROM idea_feedback WHERE owner_user_id = $1 AND report_id = $2",
      [this.user.id, reportId],
    );
    return rows[0] ? toIdeaFeedback(rows[0]) : undefined;
  }

  /**
   * Recent feedback for a profile, newest first — the training signal the
   * ideation prompts consume. Reads the profile owner's rows so runs on a
   * company-visible profile still learn from its owner's taste.
   */
  async listRecentIdeaFeedback(profileId: string, limit = 10): Promise<IdeaFeedbackRecord[]> {
    const profile = await this.requireProfile(profileId, "read");
    const { rows } = await this.db.query(
      `SELECT * FROM idea_feedback
       WHERE owner_user_id = $1 AND profile_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [profile.ownerUserId, profileId, limit],
    );
    return rows.map(toIdeaFeedback);
  }

  // ---------------------------------------------------- channel OAuth tokens

  /**
   * Store this user's YouTube OAuth token for a profile, encrypted at rest.
   * Owner-only, always — company visibility never extends to credentials.
   */
  async saveChannelToken(
    profileId: string,
    plaintextToken: string,
    connectedChannelId?: string,
  ): Promise<void> {
    const profile = await this.requireProfile(profileId, "write");
    if (profile.readOnly) throw new ForbiddenError("Cannot attach a token to another user's profile");
    const encrypted = encryptToken(plaintextToken);
    await this.db.query(
      `INSERT INTO channel_tokens (owner_user_id, profile_id, encrypted_token, connected_channel_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_user_id, profile_id)
       DO UPDATE SET encrypted_token = $3, connected_channel_id = $4, updated_at = now()`,
      [this.user.id, profileId, encrypted, connectedChannelId ?? null],
    );
  }

  /**
   * Decrypt this user's token for a profile, server-side, at call time.
   * Returns undefined if the profile has not been connected by this user.
   */
  async getChannelToken(profileId: string): Promise<string | undefined> {
    await this.requireProfile(profileId, "write"); // ownership required — never shared
    const { rows } = await this.db.query(
      "SELECT encrypted_token FROM channel_tokens WHERE owner_user_id = $1 AND profile_id = $2",
      [this.user.id, profileId],
    );
    if (rows.length === 0) return undefined;
    return decryptToken(rows[0].encrypted_token);
  }

  async deleteChannelToken(profileId: string): Promise<void> {
    await this.db.query(
      "DELETE FROM channel_tokens WHERE owner_user_id = $1 AND profile_id = $2",
      [this.user.id, profileId],
    );
  }

  // ------------------------------------------------------------------- usage

  async recordUsage(
    action: string,
    profileId?: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.db.query(
      "INSERT INTO usage_events (owner_user_id, action, profile_id, metadata) VALUES ($1, $2, $3, $4)",
      [this.user.id, action, profileId ?? null, metadata],
    );
  }

  /** Count of this user's actions in the last 24 hours (quota window). */
  async countUsageLastDay(action: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT count(*)::int AS n FROM usage_events
       WHERE owner_user_id = $1 AND action = $2 AND created_at > now() - interval '24 hours'`,
      [this.user.id, action],
    );
    return rows[0].n;
  }
}
