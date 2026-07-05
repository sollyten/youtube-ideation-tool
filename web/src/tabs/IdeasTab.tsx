import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type Profile, type ReportSummary } from "../api";

/** Idea Generation tab: run the pipeline and list prior idea runs. */
export function IdeasTab({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [sonarModel, setSonarModel] = useState("sonar-deep-research");

  useEffect(() => {
    api
      .listReports({ profileId: profile.id, type: "ideas" })
      .then((r) => setReports(r.reports))
      .catch(() => {});
  }, [profile.id]);

  const generate = async () => {
    setRunning(true);
    setError("");
    try {
      const result = await api.ideate(profile.id, sonarModel);
      navigate(`/reports/${result.reportId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ideation failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          Channel + competitor outliers → researched ideas → scored top 15, never repeating.
        </p>
        {!profile.readOnly && (
          <div className="row" style={{ gap: 8 }}>
            <select
              className="btn"
              value={sonarModel}
              onChange={(e) => setSonarModel(e.target.value)}
              title="Perplexity Sonar model for research"
              disabled={running}
            >
              <option value="sonar-deep-research">Sonar Deep Research (thorough)</option>
              <option value="sonar-pro">Sonar Pro (fast)</option>
            </select>
            <button className="btn btn-primary" onClick={generate} disabled={running}>
              {running ? (<><span className="spinner" /> Generating…</>) : "Generate ideas"}
            </button>
          </div>
        )}
      </div>
      {running && (
        <p className="muted">
          Fetching outliers, researching with Perplexity, scoring with the reasoning model — a few minutes.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {reports.length === 0 ? (
        <p className="muted">No runs yet.</p>
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
