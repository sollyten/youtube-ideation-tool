/**
 * Thumbnail Lab data access — ISOLATED.
 *
 * This module's ONLY dependencies are the DB pool and its own three tables.
 * It does NOT import ScopedData, the profile, idea memory, prompts, the
 * reasoning adapter, or any skill. Everything is keyed by (owner_user_id, slug)
 * and every query filters by owner_user_id so directors never see each other's
 * visual stores. See thumbnail-lab/README.md for the isolation contract.
 */
import type pg from "pg";

export interface VisualStyle {
  descriptor: Record<string, unknown>;
  negativeStyle: string[];
  updatedAt: string | null;
}

export interface ReferenceMeta {
  id: string;
  filename: string;
  note: string;
  mediaType: string;
  createdAt: string;
}

export interface ReferenceImage extends ReferenceMeta {
  data: Buffer;
}

export interface GenerationRecord {
  id: string;
  request: string;
  promptUsed: string;
  styleLocked: string;
  result: Record<string, unknown>;
  createdAt: string;
}

export class ThumbnailStore {
  constructor(
    private readonly db: pg.Pool,
    private readonly userId: string,
  ) {}

  async getStyle(slug: string): Promise<VisualStyle> {
    const { rows } = await this.db.query(
      "SELECT descriptor, negative_style, updated_at FROM thumbnail_styles WHERE owner_user_id = $1 AND slug = $2",
      [this.userId, slug],
    );
    if (rows.length === 0) return { descriptor: {}, negativeStyle: [], updatedAt: null };
    return {
      descriptor: rows[0].descriptor,
      negativeStyle: rows[0].negative_style ?? [],
      updatedAt: rows[0].updated_at?.toISOString() ?? null,
    };
  }

  async saveStyle(slug: string, descriptor: Record<string, unknown>, negativeStyle: string[]): Promise<VisualStyle> {
    const { rows } = await this.db.query(
      `INSERT INTO thumbnail_styles (owner_user_id, slug, descriptor, negative_style)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_user_id, slug)
       DO UPDATE SET descriptor = $3, negative_style = $4, updated_at = now()
       RETURNING descriptor, negative_style, updated_at`,
      [this.userId, slug, descriptor, JSON.stringify(negativeStyle)],
    );
    return {
      descriptor: rows[0].descriptor,
      negativeStyle: rows[0].negative_style ?? [],
      updatedAt: rows[0].updated_at?.toISOString() ?? null,
    };
  }

  async listReferences(slug: string): Promise<ReferenceMeta[]> {
    const { rows } = await this.db.query(
      `SELECT id, filename, note, media_type, created_at FROM thumbnail_references
       WHERE owner_user_id = $1 AND slug = $2 ORDER BY created_at`,
      [this.userId, slug],
    );
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      note: r.note,
      mediaType: r.media_type,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async getReferenceImages(slug: string): Promise<ReferenceImage[]> {
    const { rows } = await this.db.query(
      `SELECT id, filename, note, media_type, data, created_at FROM thumbnail_references
       WHERE owner_user_id = $1 AND slug = $2 ORDER BY created_at`,
      [this.userId, slug],
    );
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      note: r.note,
      mediaType: r.media_type,
      data: r.data as Buffer,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async addReference(
    slug: string,
    ref: { filename: string; note: string; mediaType: string; data: Buffer },
  ): Promise<ReferenceMeta> {
    const { rows } = await this.db.query(
      `INSERT INTO thumbnail_references (owner_user_id, slug, filename, note, media_type, data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, filename, note, media_type, created_at`,
      [this.userId, slug, ref.filename, ref.note, ref.mediaType, ref.data],
    );
    const r = rows[0];
    return { id: r.id, filename: r.filename, note: r.note, mediaType: r.media_type, createdAt: r.created_at.toISOString() };
  }

  async deleteReference(slug: string, id: string): Promise<void> {
    await this.db.query(
      "DELETE FROM thumbnail_references WHERE owner_user_id = $1 AND slug = $2 AND id = $3",
      [this.userId, slug, id],
    );
  }

  async recordGeneration(
    slug: string,
    gen: { request: string; promptUsed: string; styleLocked: string; result: Record<string, unknown> },
  ): Promise<GenerationRecord> {
    const { rows } = await this.db.query(
      `INSERT INTO thumbnail_generations (owner_user_id, slug, request, prompt_used, style_locked, result)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, request, prompt_used, style_locked, result, created_at`,
      [this.userId, slug, gen.request, gen.promptUsed, gen.styleLocked, gen.result],
    );
    const r = rows[0];
    return {
      id: r.id,
      request: r.request,
      promptUsed: r.prompt_used,
      styleLocked: r.style_locked,
      result: r.result,
      createdAt: r.created_at.toISOString(),
    };
  }

  async listGenerations(slug: string): Promise<GenerationRecord[]> {
    const { rows } = await this.db.query(
      `SELECT id, request, prompt_used, style_locked, result, created_at FROM thumbnail_generations
       WHERE owner_user_id = $1 AND slug = $2 ORDER BY created_at DESC LIMIT 50`,
      [this.userId, slug],
    );
    return rows.map((r) => ({
      id: r.id,
      request: r.request,
      promptUsed: r.prompt_used,
      styleLocked: r.style_locked,
      result: r.result,
      createdAt: r.created_at.toISOString(),
    }));
  }
}
