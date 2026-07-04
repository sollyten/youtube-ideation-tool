import { useEffect, useState } from "react";
import { api, ApiError, type Profile } from "../api";

interface PerfRow {
  video: string;
  views?: number;
  averageViewPercentage?: number;
  performance_rank?: string;
  source_idea_alignment_score?: number;
}

/** Performance Tracker — LOCKED until this profile authorizes its own analytics. */
export function PerformanceTab({ profile }: { profile: Profile }) {
  const [conn, setConn] = useState<{ connected: boolean; oauthConfigured: boolean } | null>(null);
  const [rows, setRows] = useState<PerfRow[] | null>(null);
  const [learnings, setLearnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadConn = () => {
    api.connection(profile.id).then(setConn).catch(() => {});
  };
  useEffect(loadConn, [profile.id]);

  // Load the latest performance report, if any.
  useEffect(() => {
    api
      .listReports({ profileId: profile.id, type: "performance" })
      .then(async (r) => {
        if (r.reports[0]) {
          const full = await api.getReport(r.reports[0].id);
          setRows((full.report.payload as any).rows ?? []);
          setLearnings((full.report.payload as any).learnings ?? []);
        }
      })
      .catch(() => {});
  }, [profile.id]);

  const connect = async () => {
    try {
      const { authUrl } = await api.connectYoutube(profile.id);
      window.location.href = authUrl; // top-level redirect to Google consent
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start connection");
    }
  };

  const sync = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.performanceSync(profile.id);
      setRows(result.rows as PerfRow[]);
      setLearnings(result.learnings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  if (!conn) return <p className="muted"><span className="spinner" /> Loading…</p>;

  if (!conn.connected) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <p style={{ margin: "0 0 8px" }}>🔒 Performance is locked for this channel.</p>
        <p className="muted" style={{ margin: "0 0 20px" }}>
          Connect this channel's own YouTube analytics to unlock. Each channel authorizes separately —
          credentials are never shared.
        </p>
        {profile.readOnly ? (
          <p className="muted">Only the channel's owner can connect analytics.</p>
        ) : conn.oauthConfigured ? (
          <button className="btn btn-primary" onClick={connect}>Connect YouTube analytics</button>
        ) : (
          <p className="muted">YouTube OAuth is not configured on this server yet.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>Recent owned-video performance, Studio-style.</p>
        {!profile.readOnly && (
          <button className="btn btn-primary" onClick={sync} disabled={busy}>
            {busy ? (<><span className="spinner" /> Syncing…</>) : "Sync performance"}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null ? (
        <p className="muted">No sync yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Video</th>
              <th>Views</th>
              <th>Avg view %</th>
              <th>Rank</th>
              <th>Predicted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.video}</td>
                <td>{r.views?.toLocaleString() ?? "—"}</td>
                <td>{r.averageViewPercentage != null ? `${r.averageViewPercentage}%` : "—"}</td>
                <td><span className="pill accent">{r.performance_rank ?? "—"}</span></td>
                <td className="muted">{r.source_idea_alignment_score != null ? r.source_idea_alignment_score : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {learnings.length > 0 && (
        <>
          <h2>Durable learnings</h2>
          <div className="card stack">
            {learnings.map((l, i) => (
              <div key={i}>• {l}</div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            These feed future ideation and recombination runs.
          </p>
        </>
      )}
    </div>
  );
}
