import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Profile, type ReportSummary } from "../api";

const TYPES = ["ideas", "competitor", "retention", "performance"] as const;
const TYPE_LABEL: Record<string, string> = {
  ideas: "Ideas",
  competitor: "Competitor",
  retention: "Retention",
  performance: "Performance",
};

/** History tab: every saved report across all channels, newest first, filterable. */
export function History() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [channelFilter, setChannelFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.listReports(), api.listProfiles()])
      .then(([r, p]) => {
        setReports(r.reports);
        setProfiles(Object.fromEntries(p.profiles.map((x) => [x.id, x])));
      })
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(
    () =>
      reports.filter(
        (r) =>
          (!channelFilter || r.profileId === channelFilter) && (!typeFilter || r.type === typeFilter),
      ),
    [reports, channelFilter, typeFilter],
  );

  const channels = useMemo(
    () => [...new Set(reports.map((r) => r.profileId))].map((pid) => profiles[pid]).filter(Boolean),
    [reports, profiles],
  );

  return (
    <div>
      <h1>History</h1>
      <p className="muted">Every saved report across your channels. Nothing is ever overwritten.</p>
      {error && <p className="error">{error}</p>}

      <div className="row" style={{ gap: 12, margin: "16px 0" }}>
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="btn">
          <option value="">All channels</option>
          {channels.map((p) => (
            <option value={p.id} key={p.id}>{p.data.channel_name}</option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="btn">
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option value={t} key={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="muted">No reports yet.</p>
      ) : (
        <div className="stack">
          {filtered.map((r) => (
            <Link to={`/reports/${r.id}`} key={r.id} className="card clickable row spread">
              <div>
                <span className="pill">{TYPE_LABEL[r.type] ?? r.type}</span>{" "}
                <strong style={{ marginLeft: 8 }}>{profiles[r.profileId]?.data.channel_name ?? "—"}</strong>
              </div>
              <span className="muted">{new Date(r.createdAt).toLocaleString()}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
