import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Profile } from "../api";

export function Channels() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listProfiles()
      .then((r) => setProfiles(r.profiles))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 20 }}>
        <div>
          <h1>Channels</h1>
          <p className="muted">Your channels, plus any shared with the company.</p>
        </div>
        <Link to="/channels/new" className="btn btn-primary">
          Add channel
        </Link>
      </div>
      {error && <p className="error">{error}</p>}
      {profiles === null ? (
        <p className="muted">
          <span className="spinner" /> Loading…
        </p>
      ) : profiles.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <p style={{ margin: "0 0 14px" }}>No channels yet.</p>
          <p className="muted" style={{ margin: "0 0 20px" }}>
            Add your first channel to start generating ideas.
          </p>
          <Link to="/channels/new" className="btn btn-primary">
            Add channel
          </Link>
        </div>
      ) : (
        <div className="card-grid">
          {profiles.map((p) => (
            <Link to={`/channels/${p.id}`} key={p.id} className="card clickable">
              <div className="row spread">
                <strong>{p.data.channel_name}</strong>
                {p.readOnly ? (
                  <span className="pill">shared</span>
                ) : p.visibility === "company" ? (
                  <span className="pill accent">company</span>
                ) : null}
              </div>
              <p className="muted" style={{ margin: "6px 0 12px" }}>
                {p.data.niche}
              </p>
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                {p.data.stats?.subscriber_count?.toLocaleString()} subscribers · baseline{" "}
                {p.data.stats?.median_views?.toLocaleString()} views
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
