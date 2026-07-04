import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type Profile, type ReportSummary } from "../api";

/** Channel page: profile facts, inline focus editing, idea generation, run history. */
export function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  const [editingFocus, setEditingFocus] = useState(false);
  const [focusDraft, setFocusDraft] = useState("");

  const load = () => {
    if (!id) return;
    api.getProfile(id).then((r) => setProfile(r.profile)).catch((e) => setError(e.message));
    api.listReports({ profileId: id, type: "ideas" }).then((r) => setReports(r.reports)).catch(() => {});
  };

  useEffect(load, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!profile) {
    return (
      <p className="muted">
        <span className="spinner" /> Loading…
      </p>
    );
  }

  const d = profile.data;

  const saveFocus = async () => {
    try {
      const updated = await api.patchProfile(profile.id, { focus_statement: focusDraft });
      setProfile(updated.profile);
      setEditingFocus(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save focus");
    }
  };

  const generate = async () => {
    setRunning(true);
    setError("");
    try {
      const result = await api.ideate(profile.id);
      navigate(`/reports/${result.reportId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ideation failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 4 }}>
        <h1>{d.channel_name}</h1>
        {!profile.readOnly && (
          <button className="btn btn-primary" onClick={generate} disabled={running}>
            {running ? (
              <>
                <span className="spinner" /> Generating…
              </>
            ) : (
              "Generate ideas"
            )}
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {d.stats?.subscriber_count?.toLocaleString()} subscribers · median{" "}
        {d.stats?.median_views?.toLocaleString()} views · {d.niche}
        {profile.readOnly && (
          <>
            {" "}
            · <span className="pill">shared read-only</span>
          </>
        )}
      </p>
      {running && (
        <p className="muted">
          Fetching outliers, researching with Perplexity, and scoring with the reasoning model —
          this can take a few minutes. Leave this page open.
        </p>
      )}

      <h2>Near-term focus</h2>
      <div className="card">
        {editingFocus ? (
          <div className="stack">
            <textarea value={focusDraft} onChange={(e) => setFocusDraft(e.target.value)} autoFocus />
            <div className="row">
              <button className="btn btn-primary" onClick={saveFocus} disabled={!focusDraft.trim()}>
                Save focus
              </button>
              <button className="btn btn-ghost" onClick={() => setEditingFocus(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="row spread">
            <p style={{ margin: 0 }}>{d.focus?.statement}</p>
            {!profile.readOnly && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setFocusDraft(d.focus?.statement ?? "");
                  setEditingFocus(true);
                }}
              >
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      <h2>Profile</h2>
      <div className="card stack">
        <div><span className="muted">Style (creator's words):</span> {d.user_style_description}</div>
        <div><span className="muted">Format:</span> {d.format_style}</div>
        <div><span className="muted">Tone:</span> {d.tone}</div>
        <div><span className="muted">House style:</span> {d.house_style_notes}</div>
        <div>
          <span className="muted">Audience:</span> {d.audience?.age_ranges?.join(", ")} ·{" "}
          {d.audience?.top_countries?.join(", ")}
        </div>
        <div>
          <span className="muted">Competitors:</span>{" "}
          {d.competitors?.length ? d.competitors.map((c) => c.name).join(", ") : "none"}
        </div>
        {d.resources?.length > 0 && (
          <div>
            <span className="muted">Resources:</span> {d.resources.map((r) => r.label).join(", ")}
          </div>
        )}
      </div>

      <h2>Idea runs</h2>
      {reports.length === 0 ? (
        <p className="muted">No runs yet. Generate ideas to get started.</p>
      ) : (
        <div className="stack">
          {reports.map((r) => (
            <Link to={`/reports/${r.id}`} key={r.id} className="card clickable row spread">
              <span>Idea run</span>
              <span className="muted">{new Date(r.createdAt).toLocaleString()}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
