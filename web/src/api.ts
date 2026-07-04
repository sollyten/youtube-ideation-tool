/** Thin typed client for the backend API. Session rides on the httpOnly cookie. */

export interface User {
  id: string;
  email: string;
  name: string;
  role: "director" | "admin";
}

export interface Profile {
  id: string;
  ownerUserId: string;
  slug: string;
  visibility: "private" | "company";
  data: ProfileData;
  createdAt: string;
  updatedAt: string;
  readOnly: boolean;
}

export interface ProfileData {
  slug: string;
  channel_name: string;
  channel_url: string;
  channel_id: string;
  focus: { statement: string; last_updated: string };
  user_style_description: string;
  resources: Array<{ id: string; label: string; type: string; content: string; added_at: string }>;
  competitors: Array<{ name: string; url: string; channel_id: string }>;
  audience: { age_ranges: string[]; top_countries: string[] };
  niche: string;
  format_style: string;
  tone: string;
  house_style_notes: string;
  recent_topics: string[];
  learnings: string[];
  stats: {
    subscriber_count: number;
    view_count: number;
    video_count: number;
    median_views: number;
    snapshot_date: string;
  };
}

export interface ScoredIdea {
  title: string;
  premise: string;
  alignment_score: number;
  subscores: Record<string, number>;
  why_it_fits: string;
  why_now: string;
  recommended_format_angle: string;
}

export interface ReportSummary {
  id: string;
  profileId: string;
  type: string;
  createdAt: string;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  register: (input: { email: string; password: string; name: string }) =>
    call<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) =>
    call<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => call<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  me: () => call<{ user: User }>("/api/auth/me"),

  listProfiles: () => call<{ profiles: Profile[] }>("/api/profiles"),
  getProfile: (id: string) => call<{ profile: Profile }>(`/api/profiles/${id}`),
  previewProfile: (input: unknown) =>
    call<{ slug: string; data: ProfileData; warnings: string[] }>("/api/profiles/preview", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  saveProfile: (input: { slug: string; data: ProfileData; overwrite?: boolean }) =>
    call<{ profile: Profile }>("/api/profiles", { method: "POST", body: JSON.stringify(input) }),
  patchProfile: (id: string, patch: Record<string, unknown>) =>
    call<{ profile: Profile }>(`/api/profiles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  ideate: (profileId: string) =>
    call<{ reportId: string; ideas: ScoredIdea[]; meta: Record<string, unknown> }>(
      `/api/profiles/${profileId}/ideate`,
      { method: "POST", body: JSON.stringify({}) },
    ),

  listReports: (filter: { profileId?: string; type?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.profileId) params.set("profile_id", filter.profileId);
    if (filter.type) params.set("type", filter.type);
    const qs = params.toString();
    return call<{ reports: ReportSummary[] }>(`/api/reports${qs ? `?${qs}` : ""}`);
  },
  getReport: (id: string) =>
    call<{ report: ReportSummary & { payload: Record<string, unknown> } }>(`/api/reports/${id}`),
};
